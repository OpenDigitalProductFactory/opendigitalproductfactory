// The Workroom runtime supervisor (BI-05715F4C, design
// 2026-10-07-durable-delegation-ledger-design.md §4.7).
//
// A room drives an agent CLI as a supervised runtime: the supervisor opens the
// session through an ExecutorAdapter, gives it the room's own scoped MCP
// credential, writes everything the session does to the room's sequenced log,
// answers its questions by the room's policy (escalating the ones that reach
// past the sandbox to a room decision), and revokes the credential when the
// session ends.
//
// A live session is process-bound (§4.6): its process is this portal's. What
// outlives the process is durable (BI-F5D58F29, agent dialog broker §7.1): the
// supervision record on the room (thread, status, the person who started it,
// the address a room message names it by, its heartbeat and delivery cursor)
// and every held question, on a CoworkerActionEnvelope. On boot the portal
// re-attaches each supervised session to its stored thread, or marks it
// supervision-lost on the room.

import { createHash, randomUUID } from "node:crypto";

import { prisma } from "@dpf/db";
import { recordWorkCapsuleActivity } from "@/lib/work-capsules/work-capsule-activity-store";
import type { CapsuleDb, WorkCapsuleActor } from "@/lib/work-capsules/work-capsule-store-types";
import type { WorkCapsuleActivityKind } from "@/lib/work-capsules";
import { TERMINAL_WORKROOM_STATUSES } from "@/lib/work-management/standing-room-nesting";

import { createEnvelopeHeldRequestStore, type HeldRequestStore, type HeldRuntimeRequest } from "./held-request-store";
import { decideClaudeToolCall, decideCodexRequest } from "./runtime-request-policy";
import {
  DEFAULT_RUNTIME_CWD,
  providerClientAgentId,
  readStoredRuntimeSession,
  sessionQualifier,
  type StoredRuntimeSession,
  type SupervisionActor,
} from "./supervised-session";
import type { ExecutorAdapter, RuntimeDecision, RuntimeEvent, RuntimeProvider, RuntimeSession } from "./types";

export { DEFAULT_RUNTIME_CWD, readStoredRuntimeSession, type StoredRuntimeSession };

/** A session not heard from for this long is not re-attached on boot: it is marked lost, quietly. */
export const REATTACH_HORIZON_MS = 24 * 60 * 60_000;

type LiveSession = {
  capsuleId: string;
  roomId: string;
  provider: RuntimeProvider;
  session: RuntimeSession;
  tokenId: string;
  cwd: string;
  actor: WorkCapsuleActor;
  /** Codex requests waiting on their provider answer in this process, by request id. */
  providerPending: Set<string>;
  /** Input that arrived while a turn ran and could not steer it. */
  queued: string[];
  /** Log writes, in event order. */
  writes: Promise<unknown>;
};

export type SupervisionLost = {
  capsuleId: string;
  reason: string;
  actingUserId: string | null;
  addressedAs: string | null;
  /** False for a session long silent: the room is told, nobody is woken for it. */
  wakeCoordinator: boolean;
};

export type RuntimeSupervisorDeps = {
  adapters: Partial<Record<RuntimeProvider, ExecutorAdapter>>;
  mcpUrl: string;
  issueToken(input: { userId: string; agentId: string | null; capsuleId: string; runRef: string | null }): Promise<{ tokenId: string; plaintext: string }>;
  revokeTokens(input: { capsuleId: string; reason: string; tokenId?: string }): Promise<number>;
  /** Held questions; defaults to CoworkerActionEnvelope rows. */
  held?: HeldRequestStore;
  /** The provider client's GAID, from which a session's address hangs. */
  clientGaid?(provider: RuntimeProvider): Promise<string | null>;
  /** Rooms whose stored session is still supervised, for the boot re-attach. */
  listSupervisedRooms?(): Promise<Array<{ capsuleId: string; workspaceState: unknown }>>;
  /** Tell the room supervision was lost, and wake its coordinator. */
  onSupervisionLost?(input: SupervisionLost): Promise<void>;
  now?: () => Date;
};

export type RuntimeResult = { success: boolean; error?: string; message: string; data?: Record<string, unknown> };

const refuse = (error: string, message: string): RuntimeResult => ({ success: false, error, message });

function claudeCallKey(toolName: string, input: Record<string, unknown>): string {
  return createHash("sha256").update(`${toolName}\n${JSON.stringify(input)}`).digest("hex").slice(0, 32);
}

/** The whole request, not its summary: a generic summary ("change files in the workspace") must not approve every later one. */
function requestCallKey(kind: string, summary: string, detail: Record<string, unknown>): string {
  return createHash("sha256").update(`${kind}\n${summary}\n${JSON.stringify(detail)}`).digest("hex").slice(0, 32);
}

async function defaultClientGaid(provider: RuntimeProvider): Promise<string | null> {
  const { getAgentGaidMap } = await import("@/lib/identity/principal-linking");
  const agentId = providerClientAgentId(provider);
  return (await getAgentGaidMap([agentId], prisma as never)).get(agentId) ?? null;
}

async function defaultListSupervisedRooms() {
  return prisma.workroom.findMany({
    where: {
      archivedAt: null,
      OR: ["supervised", "open"].map((status) => ({ workspaceState: { path: ["runtimeSession", "status"], equals: status } })),
    },
    select: { capsuleId: true, workspaceState: true },
  });
}

const DECISION_FOR_STATUS: Partial<Record<string, RuntimeDecision>> = { approved: "accept", declined: "decline", cancelled: "cancel" };

const supervisionActor =(actor: WorkCapsuleActor): SupervisionActor => ({ userId: actor.userId, agentId: actor.agentId, principalId: actor.principalId });

export function createRuntimeSupervisor(deps: RuntimeSupervisorDeps) {
  const live = new Map<string, LiveSession>();
  const clock = deps.now ?? (() => new Date());
  const held = deps.held ?? createEnvelopeHeldRequestStore(prisma, clock);
  const clientGaid = deps.clientGaid ?? defaultClientGaid;

  async function loadRoom(capsuleId: string) {
    return prisma.workroom.findUnique({
      where: { capsuleId },
      select: { id: true, status: true, archivedAt: true, workspaceState: true, taskRunId: true },
    });
  }

  // One read-modify-write of a room's record at a time in this process (heartbeats,
  // the cursor and finish() race otherwise), and only the runtimeSession key is
  // written, so the drive's and other writers' workspaceState keys are never lost.
  const sessionWrites = new Map<string, Promise<unknown>>();
  function writeSession(roomId: string, update: (current: StoredRuntimeSession | null) => StoredRuntimeSession | null): Promise<void> {
    const run = async () => {
      const room = await prisma.workroom.findUnique({ where: { id: roomId }, select: { workspaceState: true } });
      const next = update(readStoredRuntimeSession(room?.workspaceState));
      await prisma.$executeRaw`UPDATE "WorkCapsule" SET "workspaceState" = jsonb_set(COALESCE("workspaceState", '{}'::jsonb), '{runtimeSession}', ${JSON.stringify(next)}::jsonb, true) WHERE "id" = ${roomId}`;
    };
    const queued = (sessionWrites.get(roomId) ?? Promise.resolve()).catch(() => {}).then(run);
    sessionWrites.set(roomId, queued);
    void queued.finally(() => { if (sessionWrites.get(roomId) === queued) sessionWrites.delete(roomId); }).catch(() => {});
    return queued;
  }

  const patchSession = (roomId: string, patch: Partial<StoredRuntimeSession>) =>
    writeSession(roomId, (current) => (current ? { ...current, ...patch } : null));

  /** The runtime records as the person who opened it, attributed to the runtime agent. */
  const runtimeActor = (actor: WorkCapsuleActor): WorkCapsuleActor => ({ ...actor, agentId: "workroom-runtime" });

  function log(roomId: string, kind: WorkCapsuleActivityKind, summary: string, payload: Record<string, unknown>, actor: WorkCapsuleActor) {
    return recordWorkCapsuleActivity(prisma as unknown as CapsuleDb, { workCapsuleId: roomId, kind, summary: summary.slice(0, 2000), payload, actor });
  }

  /**
   * BI-53BED66C: a turn that failed on the plan's usage limit says so on the
   * room, with the provider's stated reset, so the room waits visibly and is
   * offered to an unblocked executor instead of going quiet.
   */
  async function recordPlanLimit(entry: LiveSession, error: string | null) {
    const [{ runtimePlanLimit, formatCentral }, { parseAbsoluteResetAt }] = await Promise.all([
      import("@/lib/work-capsules/executor-capacity"), import("@/lib/routing/cli-limit-reset")]);
    const limit = runtimePlanLimit(entry.provider, error, clock(), parseAbsoluteResetAt);
    if (!limit) return;
    if (limit.resetAt) {
      const { heartbeatWorkCapsule } = await import("@/lib/work-capsules/workroom-lease");
      await heartbeatWorkCapsule({ db: prisma as unknown as CapsuleDb, capsuleId: entry.capsuleId, actor: entry.actor, onHeldByOther: "keep",
        checkpoint: { capacity: { provider: limit.provider, resetAt: limit.resetAt.toISOString() } } });
    }
    await log(entry.roomId, "error", limit.resetAt
      ? `Plan limit reached on ${entry.provider}; expected back by ${formatCentral(limit.resetAt)} (may return sooner).`
      : `Plan limit reached on ${entry.provider}; the provider gave no reset time.`,
    { kind: "executor-plan-limit", provider: limit.provider, resetAt: limit.resetAt?.toISOString() ?? null }, runtimeActor(entry.actor));
  }

  function enqueue(entry: LiveSession, write: () => Promise<unknown>) {
    entry.writes = entry.writes.then(write).catch((error: unknown) => {
      console.error("[workroom-runtime] log write failed for %s: %s", JSON.stringify(entry.capsuleId), error instanceof Error ? error.message : "unknown");
    });
  }

  async function startNext(entry: LiveSession) {
    const next = entry.queued.shift();
    if (next !== undefined) await entry.session.startTurn(next);
  }

  async function finish(entry: LiveSession, reason: string) {
    if (live.get(entry.capsuleId) !== entry) return;
    live.delete(entry.capsuleId);
    await deps.revokeTokens({ capsuleId: entry.capsuleId, reason, tokenId: entry.tokenId });
    await writeSession(entry.roomId, (current) => ({
      ...(current ?? { provider: entry.provider, tokenId: entry.tokenId, openedAt: "", cwd: entry.cwd }),
      provider: entry.provider, threadId: entry.session.threadId(), tokenId: entry.tokenId, status: "closed",
      closedAt: clock().toISOString(), cwd: entry.cwd,
    }));
  }

  async function holdRequest(entry: LiveSession, request: HeldRuntimeRequest, reason: string) {
    if (request.answeredBy === "provider") entry.providerPending.add(request.requestId);
    await held.hold({ capsuleId: entry.capsuleId, provider: entry.provider, providerThreadId: entry.session.threadId(), actor: supervisionActor(entry.actor), request, reason });
    await log(entry.roomId, "question", `Held for a room decision: ${request.summary} (${reason}).`,
      { requestId: request.requestId, kind: request.kind, reason, decideWith: "drive_workroom_runtime action=decide" }, runtimeActor(entry.actor));
  }

  function onEvent(entry: LiveSession, event: RuntimeEvent) {
    const { roomId } = entry;
    switch (event.type) {
      case "turn-started":
        enqueue(entry, () => log(roomId, "action", `${entry.provider} started a turn`, { turnId: event.turnId, provider: entry.provider }, runtimeActor(entry.actor)));
        enqueue(entry, () => patchSession(roomId, { lastHeartbeatAt: clock().toISOString() }));
        return;
      case "message":
        enqueue(entry, () => log(roomId, "response", event.text, { turnId: event.turnId, provider: entry.provider }, runtimeActor(entry.actor)));
        return;
      case "turn-completed":
        enqueue(entry, () => log(roomId, event.status === "failed" ? "error" : "response",
          event.status === "failed" ? `Turn failed: ${event.error ?? "no detail"}` : `Turn ${event.status}.`,
          { turnId: event.turnId, status: event.status, provider: entry.provider }, runtimeActor(entry.actor)));
        enqueue(entry, () => patchSession(roomId, { lastHeartbeatAt: clock().toISOString() }));
        if (event.status === "failed") enqueue(entry, () => recordPlanLimit(entry, event.error ?? null));
        void startNext(entry).catch(() => {});
        return;
      case "runtime-request": {
        const { request } = event;
        const verdict = decideCodexRequest(request);
        if (verdict.verdict === "accept") {
          void entry.session.respondToRuntimeRequest(request.requestId, "accept").catch(() => {});
          enqueue(entry, () => log(roomId, "action", `Accepted: ${request.summary}`, { requestId: request.requestId, kind: request.kind, reason: verdict.reason }, runtimeActor(entry.actor)));
          return;
        }
        const callKey = requestCallKey(request.kind, request.summary, request.detail);
        enqueue(entry, async () => {
          if (await held.isApproved(entry.capsuleId, callKey, entry.actor.userId)) {
            await entry.session.respondToRuntimeRequest(request.requestId, "accept");
            await log(roomId, "action", `Accepted by an earlier room decision: ${request.summary}`, { requestId: request.requestId, kind: request.kind }, runtimeActor(entry.actor));
            return;
          }
          await holdRequest(entry, { ...request, callKey, answeredBy: "provider" }, verdict.reason);
        });
        return;
      }
      case "session-exited":
        enqueue(entry, () => log(roomId, "error", `The ${entry.provider} session ended: ${event.reason}.`, { code: event.code }, runtimeActor(entry.actor)));
        void finish(entry, `session ended: ${event.reason}`).catch(() => {});
        return;
    }
  }

  async function start(input: { capsuleId: string; provider: RuntimeProvider; actor: WorkCapsuleActor; prompt?: string; model?: string | null; cwd?: string; reattach?: boolean }): Promise<RuntimeResult> {
    const adapter = deps.adapters[input.provider];
    if (!adapter) return refuse("provider_unavailable", `No ${input.provider} runtime is configured on this install.`);
    if (live.has(input.capsuleId)) return refuse("already_running", `${input.capsuleId} already has a live runtime session; stop it first.`);
    const room = await loadRoom(input.capsuleId);
    if (!room) return refuse("not_found", `Workroom ${input.capsuleId} not found.`);
    if (room.archivedAt || TERMINAL_WORKROOM_STATUSES.has(room.status)) {
      return refuse("room_terminal", `Workroom ${input.capsuleId} is ${room.status}; it cannot open a runtime.`);
    }
    const stored = readStoredRuntimeSession(room.workspaceState);
    if (stored?.status === "supervised") {
      // Process-bound (§4.6): the session died with its process. Say so, retire its credential, resume its thread.
      await deps.revokeTokens({ capsuleId: input.capsuleId, reason: "cancelled_after_process_loss", tokenId: stored.tokenId });
      if (!input.reattach) {
        await log(room.id, "error", `cancelled_after_process_loss: the ${stored.provider} session ended with its process; resuming its thread.`, { stored }, runtimeActor(input.actor));
      }
    }
    const cwd = input.cwd ?? stored?.cwd ?? DEFAULT_RUNTIME_CWD;
    const token = await deps.issueToken({ userId: input.actor.userId, agentId: input.actor.agentId, capsuleId: input.capsuleId, runRef: room.taskRunId ?? null });
    const entryRef: { current: LiveSession | null } = { current: null };
    const pendingEvents: RuntimeEvent[] = [];
    let session: RuntimeSession;
    try {
      session = await adapter.openSession({
        capsuleId: input.capsuleId, mcp: { url: deps.mcpUrl, bearerToken: token.plaintext }, cwd, model: input.model ?? null,
        resumeThreadId: stored?.provider === input.provider ? stored.threadId : null,
      }, (event) => (entryRef.current ? onEvent(entryRef.current, event) : pendingEvents.push(event)));
    } catch (error) {
      await deps.revokeTokens({ capsuleId: input.capsuleId, reason: "session failed to open", tokenId: token.tokenId });
      return refuse("runtime_unavailable", `The ${input.provider} runtime could not start: ${error instanceof Error ? error.message : "unknown error"}`);
    }
    const entry: LiveSession = {
      capsuleId: input.capsuleId, roomId: room.id, provider: input.provider, session, tokenId: token.tokenId, cwd,
      actor: input.actor, providerPending: new Set(), queued: [], writes: Promise.resolve(),
    };
    live.set(input.capsuleId, entry);
    entryRef.current = entry;
    for (const event of pendingEvents) onEvent(entry, event);
    try {
      const threadId = await session.ensureThread();
      const addressedAs = sessionQualifier(await clientGaid(input.provider).catch(() => null), threadId);
      const at = clock().toISOString();
      await writeSession(room.id, () => ({
        provider: input.provider, threadId, tokenId: token.tokenId, status: "supervised", openedAt: at, cwd,
        actor: supervisionActor(input.actor), addressedAs, lastHeartbeatAt: at,
        // The session keeps its place in the room across a resume.
        deliveredCursor: stored?.provider === input.provider ? stored.deliveredCursor ?? null : null,
      }));
      const address = addressedAs ? ` Address it in the room as ${addressedAs}.` : "";
      await log(room.id, "executor-changed", input.reattach
        ? `Re-attached the supervised ${input.provider} runtime to its thread after a portal restart.${address}`
        : `Opened a supervised ${input.provider} runtime.${address}`,
      { provider: input.provider, threadId, tokenId: token.tokenId, addressedAs }, input.reattach ? runtimeActor(input.actor) : input.actor);
      if (input.prompt?.trim()) await session.startTurn(input.prompt.trim());
      return { success: true, message: `${input.provider} runtime open on ${input.capsuleId}.`, data: { capsuleId: input.capsuleId, provider: input.provider, threadId, addressedAs } };
    } catch (error) {
      await session.close().catch(() => {});
      await finish(entry, "session failed to start");
      return refuse("runtime_unavailable", `The ${input.provider} runtime could not open its thread: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  async function turn(input: { capsuleId: string; prompt: string; steer?: boolean }): Promise<RuntimeResult> {
    const entry = live.get(input.capsuleId);
    if (!entry) return refuse("no_session", `${input.capsuleId} has no live runtime session in this process; start one (it resumes the room's thread).`);
    if (entry.session.activeTurnId()) {
      if (input.steer && await entry.session.steerTurn(input.prompt)) {
        await log(entry.roomId, "action", "Steered the turn in progress.", { turnId: entry.session.activeTurnId() }, runtimeActor(entry.actor));
        return { success: true, message: "Steered the turn in progress.", data: { outcome: "steered" } };
      }
      entry.queued.push(input.prompt);
      return { success: true, message: "A turn is running; the input runs as the next turn.", data: { outcome: "queued", queued: entry.queued.length } };
    }
    const { turnId } = await entry.session.startTurn(input.prompt);
    return { success: true, message: "Turn started.", data: { outcome: "started", turnId } };
  }

  async function markLost(capsuleId: string, stored: StoredRuntimeSession, reason: string, wakeCoordinator: boolean) {
    const room = await loadRoom(capsuleId);
    if (!room) return;
    await deps.revokeTokens({ capsuleId, reason: `supervision-lost: ${reason}`, tokenId: stored.tokenId });
    await patchSession(room.id, { status: "supervision-lost", lostReason: reason, closedAt: clock().toISOString() });
    // The room log is written as the person who started supervision; a record
    // from before item D names nobody, and the room notice alone says so.
    if (stored.actor) {
      await log(room.id, "error", `supervision-lost: the ${stored.provider} session${stored.addressedAs ? ` ${stored.addressedAs}` : ""} could not be re-attached after a portal restart (${reason}). Messages addressed to it wait on the room cursor until the runtime is started again.`,
        { stored, reason }, runtimeActor({ ...stored.actor }));
    }
    await deps.onSupervisionLost?.({ capsuleId, reason, actingUserId: stored.actor?.userId ?? null, addressedAs: stored.addressedAs ?? null, wakeCoordinator });
  }

  return {
    start,
    turn,

    /** True when this process holds the room's session: only then can a message become its turn. */
    isLive(capsuleId: string): boolean {
      return live.has(capsuleId);
    },

    /** A room message addressed to the session, as its next turn; the cursor moves past what it was handed. */
    async deliver(input: { capsuleId: string; prompt: string; deliveredCursor: string }): Promise<RuntimeResult> {
      const entry = live.get(input.capsuleId);
      if (!entry) return refuse("no_session", `${input.capsuleId} has no live runtime session in this process.`);
      const result = await turn({ capsuleId: input.capsuleId, prompt: input.prompt });
      if (result.success) {
        await patchSession(entry.roomId, { deliveredCursor: input.deliveredCursor, lastHeartbeatAt: clock().toISOString() });
        enqueue(entry, () => log(entry.roomId, "action", "A room message addressed to this session was delivered as a turn.",
          { outcome: result.data?.["outcome"] ?? null }, runtimeActor(entry.actor)));
      }
      return result;
    },

    async interrupt(capsuleId: string): Promise<RuntimeResult> {
      const entry = live.get(capsuleId);
      if (!entry) return refuse("no_session", `${capsuleId} has no live runtime session in this process; start one (it resumes the room's thread).`);
      entry.queued.length = 0;
      await entry.session.interruptTurn();
      return { success: true, message: "Interrupt sent; the turn reports interrupted when it stops." };
    },

    async stop(input: { capsuleId: string; reason: string; actor: WorkCapsuleActor }): Promise<RuntimeResult> {
      const entry = live.get(input.capsuleId);
      if (!entry) {
        const revoked = await deps.revokeTokens({ capsuleId: input.capsuleId, reason: input.reason });
        return { success: true, message: `No live session; revoked ${revoked} stale credential(s).`, data: { revoked } };
      }
      await entry.session.close();
      await finish(entry, input.reason);
      await log(entry.roomId, "executor-changed", `Stopped the ${entry.provider} runtime: ${input.reason}`, {}, input.actor);
      return { success: true, message: `Stopped the ${entry.provider} runtime; its credential is revoked.` };
    },

    /** Settle a held question. It is durable, so it is decidable whether or not the session is live here. */
    async decide(input: { capsuleId: string; requestId: string; decision: RuntimeDecision; reason: string; actor: WorkCapsuleActor }): Promise<RuntimeResult> {
      const found = await held.find(input.capsuleId, input.requestId);
      if (!found) return refuse("not_found", `No held request ${input.requestId} on ${input.capsuleId}.`);
      const entry = live.get(input.capsuleId);
      const settled = await held.settle({ capsuleId: input.capsuleId, requestId: input.requestId, decision: input.decision, decidedBy: input.actor.userId, reason: input.reason });
      if (settled !== "settled") {
        // Decided elsewhere (the inbox) while the Codex session still waits on it: pass that decision on.
        const recorded = DECISION_FOR_STATUS[found.status];
        if (recorded && entry?.providerPending.has(input.requestId)) {
          entry.providerPending.delete(input.requestId);
          await entry.session.respondToRuntimeRequest(input.requestId, recorded);
          return { success: true, message: `${input.requestId} was already decided ${recorded}; the waiting session was answered with that decision.` };
        }
        return refuse("already_decided", `${input.requestId} was already decided or has expired (${found.status}).`);
      }
      let applied = "The decision applies when the session asks again.";
      if (entry?.providerPending.has(input.requestId)) {
        entry.providerPending.delete(input.requestId);
        await entry.session.respondToRuntimeRequest(input.requestId, input.decision);
        applied = "The waiting session was answered.";
      }
      const roomId = entry?.roomId ?? (await loadRoom(input.capsuleId))?.id;
      if (roomId) {
        await log(roomId, "response", `Decided ${input.decision}: ${found.request.summary} (${input.reason})`, { requestId: input.requestId, decision: input.decision }, input.actor);
      }
      return { success: true, message: `Recorded ${input.decision} for ${input.requestId}. ${applied}` };
    },

    /** Claude's --permission-prompt-tool, answered for the room the calling credential is bound to. */
    async claudePermission(input: { capsuleId: string; toolName: string; toolInput: Record<string, unknown> }):
      Promise<{ behavior: "allow"; updatedInput: Record<string, unknown> } | { behavior: "deny"; message: string }> {
      const entry = live.get(input.capsuleId);
      if (!entry) return { behavior: "deny", message: "This room has no live runtime session." };
      const verdict = decideClaudeToolCall({ toolName: input.toolName, input: input.toolInput, cwd: entry.cwd });
      if (verdict.verdict === "accept") return { behavior: "allow", updatedInput: input.toolInput };
      const callKey = claudeCallKey(input.toolName, input.toolInput);
      if (await held.isApproved(input.capsuleId, callKey, entry.actor.userId)) return { behavior: "allow", updatedInput: input.toolInput };
      const requestId = `req-${randomUUID().slice(0, 8)}`;
      const summary = `${input.toolName} ${JSON.stringify(input.toolInput).slice(0, 300)}`;
      await holdRequest(entry, { requestId, kind: "tool", turnId: entry.session.activeTurnId(), summary, detail: input.toolInput, callKey, answeredBy: "re-ask" }, verdict.reason);
      return { behavior: "deny", message: `Held for a room decision (request ${requestId}): ${verdict.reason}. Continue with other work, or ask again once it is decided.` };
    },

    async status(capsuleId: string) {
      const entry = live.get(capsuleId);
      const heldRequests = await held.listOpen(capsuleId);
      if (entry) {
        return { live: true, provider: entry.provider, threadId: entry.session.threadId(), activeTurnId: entry.session.activeTurnId(),
          held: heldRequests, queued: entry.queued.length };
      }
      const stored = readStoredRuntimeSession((await loadRoom(capsuleId))?.workspaceState);
      return {
        live: false,
        ...(stored ? { supervision: stored.status, addressedAs: stored.addressedAs ?? null, ...(stored.lostReason ? { lostReason: stored.lostReason } : {}) } : {}),
        ...(heldRequests.length > 0 ? { held: heldRequests } : {}),
      };
    },

    /**
     * Boot: re-attach every supervised session to its stored thread, as the
     * person who started it. No turn is started, so nothing is spent. A session
     * that cannot resume is marked supervision-lost on the room.
     */
    async reattachSupervised(): Promise<{ reattached: string[]; lost: string[]; closed: string[] }> {
      const outcome = { reattached: [] as string[], lost: [] as string[], closed: [] as string[] };
      const rooms = await (deps.listSupervisedRooms ?? defaultListSupervisedRooms)();
      const now = clock().getTime();
      for (const room of rooms) {
        const stored = readStoredRuntimeSession(room.workspaceState);
        if (!stored || stored.status !== "supervised" || live.has(room.capsuleId)) continue;
        const heard = Date.parse(stored.lastHeartbeatAt ?? stored.openedAt);
        try {
          if (!Number.isFinite(heard) || now - heard > REATTACH_HORIZON_MS) {
            await markLost(room.capsuleId, stored, "not heard from in the 24 hours before the restart", false);
            outcome.lost.push(room.capsuleId);
            continue;
          }
          if (!stored.actor) {
            await markLost(room.capsuleId, stored, "no record of who started it, so it cannot be resumed as them", true);
            outcome.lost.push(room.capsuleId);
            continue;
          }
          const result = await start({ capsuleId: room.capsuleId, provider: stored.provider, actor: { ...stored.actor }, cwd: stored.cwd, reattach: true });
          if (result.success) {
            outcome.reattached.push(room.capsuleId);
          } else if (result.error === "room_terminal" || result.error === "not_found") {
            // The room ended while the portal was down: nothing is waiting on this session.
            const current = await loadRoom(room.capsuleId);
            if (current) await patchSession(current.id, { status: "closed", closedAt: clock().toISOString() });
            await deps.revokeTokens({ capsuleId: room.capsuleId, reason: "room ended", tokenId: stored.tokenId });
            outcome.closed.push(room.capsuleId);
          } else {
            await markLost(room.capsuleId, stored, result.message, true);
            outcome.lost.push(room.capsuleId);
          }
        } catch (error) {
          console.error("[workroom-runtime] re-attach failed for %s: %s", JSON.stringify(room.capsuleId), error instanceof Error ? error.message : "unknown");
        }
      }
      return outcome;
    },
  };
}

export type RuntimeSupervisor = ReturnType<typeof createRuntimeSupervisor>;
