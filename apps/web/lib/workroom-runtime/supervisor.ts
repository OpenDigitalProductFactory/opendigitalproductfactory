// The Workroom runtime supervisor (BI-05715F4C, design
// 2026-10-07-durable-delegation-ledger-design.md §4.7).
//
// A room drives an agent CLI as a supervised runtime: the supervisor opens the
// session through an ExecutorAdapter, gives it the room's own scoped MCP
// credential, records everything the session does in the room's sequenced log,
// answers its questions by the room's policy (escalating the ones that reach
// past the sandbox to a room decision), and revokes the credential when the
// session ends.
//
// BI-C64EDA33 (plan 2026-11-14-workroom-runtime-core): the supervisor is the
// process host only. It holds the live provider processes and turns what they
// report into commands. Every change to the room goes through one committed
// decision (runtime-commit.server.ts), and every side effect runs from the
// room's outbox on the effect worker (effect-worker.server.ts). A live session
// is process-bound (§4.6): on boot each supervised session is re-attached to
// its stored thread in a new generation, effects decided for the old process
// are retired rather than replayed, and input it never received stays queued.

import { createHash, randomUUID } from "node:crypto";

import { prisma } from "@dpf/db";
import type { CapsuleDb, WorkCapsuleActor } from "@/lib/work-capsules/work-capsule-store-types";
import { TERMINAL_WORKROOM_STATUSES } from "@/lib/work-management/standing-room-nesting";

import { createEffectWorker, effectResultCommandId, RetireEffectError, type EffectReport } from "./effect-worker.server";
import { createEnvelopeHeldRequestStore, type HeldRequestStore } from "./held-request-store";
import { createRuntimeCommitter, StaleEffectSettlementError, type RuntimeCommitter } from "./runtime-commit.server";
import type { RuntimeCommand } from "./runtime-decider";
import { decideClaudeToolCall } from "./runtime-request-policy";
import {
  DEFAULT_RUNTIME_CWD,
  providerClientAgentId,
  readStoredRuntimeSession,
  sessionQualifier,
  type StoredRuntimeSession,
  type SupervisionActor,
} from "./supervised-session";
import type { ExecutorAdapter, RuntimeDecision, RuntimeEvent, RuntimeProvider, RuntimeRequest, RuntimeSession } from "./types";
import { claimEffects, recoverExpiredLeases, retireOrphanedEffects, type ClaimedEffect, type EffectSqlDb } from "./workroom-effect-store";

export { DEFAULT_RUNTIME_CWD, readStoredRuntimeSession, type StoredRuntimeSession };

/** A session not heard from for this long is not re-attached on boot: it is marked lost, quietly. */
export const REATTACH_HORIZON_MS = 24 * 60 * 60_000;
const EVENT_COMMIT_ATTEMPTS = 8;

type LiveSession = {
  capsuleId: string;
  provider: RuntimeProvider;
  session: RuntimeSession;
  tokenId: string;
  cwd: string;
  actor: WorkCapsuleActor;
  /** This process's session: effects decided for another generation are not run here. */
  generation: string;
  /** Codex requests waiting on their provider answer in this process, by request id. */
  providerPending: Set<string>;
  /** Provider events in the order they arrived; each becomes a command with a deterministic id. */
  eventSeq: number;
  commits: Promise<unknown>;
};

export type SupervisionLost = {
  capsuleId: string;
  reason: string;
  actingUserId: string | null;
  addressedAs: string | null;
  /** False for a session long silent: the room is told, nobody is woken for it. */
  wakeCoordinator: boolean;
};

export type EffectStorePort = {
  claim(input: { owner: string; liveGenerations: string[]; limit: number; leaseMs: number }): Promise<ClaimedEffect[]>;
  recoverExpired(): Promise<number>;
  /** Boot: retire process-bound effects no surviving process can run. */
  retireOrphaned(): Promise<number>;
};

export type RuntimeSupervisorDeps = {
  adapters: Partial<Record<RuntimeProvider, ExecutorAdapter>>;
  mcpUrl: string;
  issueToken(input: { userId: string; agentId: string | null; capsuleId: string; runRef: string | null }): Promise<{ tokenId: string; plaintext: string }>;
  revokeTokens(input: { capsuleId: string; reason: string; tokenId?: string }): Promise<number>;
  /** BI-1687CCD2: the handoff a session of another provider starts from (runtime-handoff.ts). */
  buildHandoff?(input: { roomId: string; fromProvider: RuntimeProvider; toProvider: RuntimeProvider; since: string | null }): Promise<{ text: string; included: number; omitted: number; bytes: number }>;
  /** Held questions; defaults to CoworkerActionEnvelope rows. */
  held?: HeldRequestStore;
  /** The provider client's GAID, from which a session's address hangs. */
  clientGaid?(provider: RuntimeProvider): Promise<string | null>;
  /** Rooms whose stored session is still supervised, for the boot re-attach. */
  listSupervisedRooms?(): Promise<Array<{ capsuleId: string; workspaceState: unknown }>>;
  /** Tell the room supervision was lost, and wake its coordinator. */
  onSupervisionLost?(input: SupervisionLost): Promise<void>;
  /** Commits one runtime command; defaults to the room's receipted transaction. */
  commit?: RuntimeCommitter;
  /** The room outbox; defaults to WorkroomEffect rows. */
  effects?: EffectStorePort;
  /** This portal process; defaults to a fresh id per process. */
  hostId?: string;
  now?: () => Date;
};

export type RuntimeResult = { success: boolean; error?: string; message: string; data?: Record<string, unknown> };

const refuse = (error: string, message: string): RuntimeResult => ({ success: false, error, message });
const describe = (error: unknown) => (error instanceof Error ? error.message : "unknown error");
/** The worker reports effect results as the runtime itself. */
const RUNTIME_ACTOR: WorkCapsuleActor = { userId: "workroom-runtime", agentId: "workroom-runtime", principalId: null };

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

function defaultEffectStore(clock: () => Date): EffectStorePort {
  const run = prisma as unknown as EffectSqlDb;
  return {
    claim: (input) => claimEffects(run, { ...input, now: clock() }),
    recoverExpired: () => recoverExpiredLeases(run, clock()),
    retireOrphaned: () => retireOrphanedEffects(run, clock()),
  };
}

const DECISION_FOR_STATUS: Partial<Record<string, RuntimeDecision>> = { approved: "accept", declined: "decline", cancelled: "cancel" };

const supervisionActor = (actor: WorkCapsuleActor): SupervisionActor => ({ userId: actor.userId, agentId: actor.agentId, principalId: actor.principalId });

const TURN_MESSAGES: Record<string, string> = {
  started: "Turn requested.",
  queued: "A turn is running; the input runs as the next turn.",
  "steer-requested": "Steering the turn in progress.",
};

export function createRuntimeSupervisor(deps: RuntimeSupervisorDeps) {
  const live = new Map<string, LiveSession>();
  const clock = deps.now ?? (() => new Date());
  const held = deps.held ?? createEnvelopeHeldRequestStore(prisma, clock);
  const clientGaid = deps.clientGaid ?? defaultClientGaid;
  const commitRuntime = deps.commit ?? createRuntimeCommitter({ now: clock });
  const effects = deps.effects ?? defaultEffectStore(clock);
  const hostId = deps.hostId ?? randomUUID();
  const at = () => clock().toISOString();

  async function loadRoom(capsuleId: string) {
    return prisma.workroom.findUnique({
      where: { capsuleId },
      select: { id: true, status: true, archivedAt: true, workspaceState: true, taskRunId: true },
    });
  }

  async function commit(capsuleId: string, commandId: string, command: RuntimeCommand, actor: WorkCapsuleActor) {
    const reply = await commitRuntime({ capsuleId, commandId, command, actor });
    worker.kick();
    return reply;
  }

  /** Provider events commit in arrival order; a failed commit is retried with the same id, so it lands once. */
  function onEvent(entry: LiveSession, event: RuntimeEvent) {
    entry.eventSeq += 1;
    const commandId = `runtime-event:${entry.generation}:${entry.eventSeq}`;
    const command: RuntimeCommand = { type: "runtime.event", generation: entry.generation, event, at: at() };
    entry.commits = entry.commits.then(async () => {
      try {
        // A dropped event would leave the record wrong (a turn that never ends), so it is retried hard.
        for (let attempt = 1; ; attempt += 1) {
          try {
            await commit(entry.capsuleId, commandId, command, entry.actor);
            break;
          } catch (error) {
            if (attempt >= EVENT_COMMIT_ATTEMPTS) throw error;
            await new Promise((resolve) => setTimeout(resolve, Math.min(5000, 200 * 2 ** attempt)));
          }
        }
      } finally {
        // A process that exited is gone whether or not its exit was recorded; never keep it as the live session.
        if (event.type === "session-exited" && live.get(entry.capsuleId) === entry) live.delete(entry.capsuleId);
      }
    }).catch((error: unknown) => {
      console.error("[workroom-runtime] event commit failed for %s: %s", JSON.stringify(entry.capsuleId), describe(error));
    });
  }

  function liveFor(effect: ClaimedEffect): LiveSession | null {
    const entry = live.get(effect.capsuleId) ?? null;
    if (effect.processBound && (!entry || entry.generation !== effect.sessionGeneration)) {
      throw new RetireEffectError("the provider process this was decided for is gone");
    }
    return entry;
  }

  async function recordPlanLimit(payload: Record<string, unknown>, capsuleId: string): Promise<Record<string, unknown>> {
    const [{ runtimePlanLimit, formatCentral }, { parseAbsoluteResetAt }] = await Promise.all([
      import("@/lib/work-capsules/executor-capacity"), import("@/lib/routing/cli-limit-reset")]);
    const provider = payload["provider"] as RuntimeProvider;
    const limit = runtimePlanLimit(provider, (payload["error"] as string | null) ?? null, clock(), parseAbsoluteResetAt);
    if (!limit) return {};
    if (limit.resetAt) {
      // BI-53BED66C: the room waits visibly on the provider's stated reset, and is offered to an unblocked executor.
      const { recordExecutorCapacityNote } = await import("@/lib/work-capsules/workroom-lease");
      await recordExecutorCapacityNote({ db: prisma as unknown as CapsuleDb, capsuleId, capacity: { provider: limit.provider, resetAt: limit.resetAt.toISOString() } });
    }
    return {
      provider: limit.provider, resetAt: limit.resetAt?.toISOString() ?? null,
      summary: limit.resetAt
        ? `Plan limit reached on ${provider}; expected back by ${formatCentral(limit.resetAt)} (may return sooner).`
        : `Plan limit reached on ${provider}; the provider gave no reset time.`,
    };
  }

  async function execute(effect: ClaimedEffect): Promise<Record<string, unknown>> {
    const entry = liveFor(effect);
    const p = effect.payload;
    switch (effect.kind) {
      case "start-turn": {
        // At most once: a retry after an unanswered start finds the turn already running and does not send it again.
        const running = effect.attemptCount > 1 ? entry!.session.activeTurnId() : null;
        if (running) return { turnId: running, alreadyRunning: true };
        return { turnId: (await entry!.session.startTurn(String(p["prompt"] ?? ""))).turnId };
      }
      case "steer-turn":
        return { steered: await entry!.session.steerTurn(String(p["prompt"] ?? "")) };
      case "interrupt-turn":
        await entry!.session.interruptTurn();
        return {};
      case "answer-request":
        entry!.providerPending.delete(String(p["requestId"]));
        await entry!.session.respondToRuntimeRequest(String(p["requestId"]), p["decision"] as RuntimeDecision);
        return {};
      case "hold-request": {
        const request = p["request"] as RuntimeRequest;
        const callKey = requestCallKey(request.kind, request.summary, request.detail);
        if (await held.isApproved(effect.capsuleId, callKey, entry!.actor.userId)) {
          await entry!.session.respondToRuntimeRequest(request.requestId, "accept");
          return { outcome: "approved" };
        }
        entry!.providerPending.add(request.requestId);
        await held.hold({ capsuleId: effect.capsuleId, provider: entry!.provider, providerThreadId: entry!.session.threadId(),
          actor: supervisionActor(entry!.actor), request: { ...request, callKey, answeredBy: "provider" }, reason: String(p["reason"] ?? "") });
        return { outcome: "held" };
      }
      case "close-session":
        await entry!.session.close();
        if (live.get(effect.capsuleId) === entry) live.delete(effect.capsuleId);
        return {};
      case "revoke-token":
        return { revoked: await deps.revokeTokens({ capsuleId: effect.capsuleId, reason: String(p["reason"] ?? "session ended"), tokenId: String(p["tokenId"]) }) };
      case "announce-supervision-lost":
        await deps.onSupervisionLost?.({ capsuleId: effect.capsuleId, reason: String(p["reason"] ?? ""), actingUserId: (p["actingUserId"] as string | null) ?? null,
          addressedAs: (p["addressedAs"] as string | null) ?? null, wakeCoordinator: p["wakeCoordinator"] === true });
        return {};
      case "record-plan-limit":
        return recordPlanLimit(p, effect.capsuleId);
    }
  }

  async function report(effect: ClaimedEffect, outcome: EffectReport) {
    try {
      await commitRuntime({ capsuleId: effect.capsuleId, commandId: effectResultCommandId(effect), actor: RUNTIME_ACTOR,
        command: { type: "effect.settled", effectId: effect.id, attempt: effect.attemptCount, kind: effect.kind, payload: effect.payload, ...outcome } });
    } catch (error) {
      if (!(error instanceof StaleEffectSettlementError)) throw error;
    }
  }

  const worker = createEffectWorker({
    owner: hostId,
    claim: (input) => effects.claim(input),
    recoverExpired: () => effects.recoverExpired(),
    liveGenerations: () => [...live.values()].map((entry) => entry.generation),
    execute,
    report,
  });

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
    const cwd = input.cwd ?? stored?.cwd ?? DEFAULT_RUNTIME_CWD;
    const token = await deps.issueToken({ userId: input.actor.userId, agentId: input.actor.agentId, capsuleId: input.capsuleId, runRef: room.taskRunId ?? null });
    const generation = randomUUID();
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
      return refuse("runtime_unavailable", `The ${input.provider} runtime could not start: ${describe(error)}`);
    }
    // Events wait until the session record names this generation; otherwise they would read as stale.
    let releaseEvents: () => void = () => {};
    const entry: LiveSession = {
      capsuleId: input.capsuleId, provider: input.provider, session, tokenId: token.tokenId, cwd, actor: input.actor, generation,
      providerPending: new Set(), eventSeq: 0, commits: new Promise<void>((resolve) => { releaseEvents = resolve; }),
    };
    live.set(input.capsuleId, entry);
    entryRef.current = entry;
    for (const event of pendingEvents) onEvent(entry, event);
    try {
      const threadId = await session.ensureThread();
      const addressedAs = sessionQualifier(await clientGaid(input.provider).catch(() => null), threadId);
      // BI-1687CCD2: a thread only resumes in its own CLI; the other one starts from the room's log.
      const built = stored && stored.provider !== input.provider && deps.buildHandoff
        ? await deps.buildHandoff({ roomId: room.id, fromProvider: stored.provider, toProvider: input.provider, since: stored.openedAt || null })
        : null;
      const handoff = built && stored ? { ...built, fromProvider: stored.provider, fromThreadId: stored.threadId } : null;
      const reply = await commit(input.capsuleId, `session-open:${generation}`, {
        type: "session.open", provider: input.provider, threadId, tokenId: token.tokenId, cwd, actor: supervisionActor(input.actor),
        addressedAs, generation, hostId, reattach: input.reattach === true, prompt: input.prompt?.trim() || null, handoff, at: at(),
      }, input.actor);
      if (!reply) throw new Error(`Workroom ${input.capsuleId} not found`);
      releaseEvents();
      return { success: true, message: `${input.provider} runtime open on ${input.capsuleId}.`, data: { capsuleId: input.capsuleId, provider: input.provider, threadId, addressedAs } };
    } catch (error) {
      releaseEvents();
      live.delete(input.capsuleId);
      await session.close().catch(() => {});
      await deps.revokeTokens({ capsuleId: input.capsuleId, reason: "session failed to start", tokenId: token.tokenId });
      return refuse("runtime_unavailable", `The ${input.provider} runtime could not open its thread: ${describe(error)}`);
    }
  }

  async function turnCommand(capsuleId: string, command: RuntimeCommand, commandId?: string): Promise<RuntimeResult> {
    const entry = live.get(capsuleId);
    if (!entry) return refuse("no_session", `${capsuleId} has no live runtime session in this process; start one (it resumes the room's thread).`);
    const reply = await commit(capsuleId, commandId ?? `turn:${randomUUID()}`, command, entry.actor);
    if (!reply || reply["outcome"] === "no-session") return refuse("no_session", `${capsuleId} has no supervised runtime session.`);
    const outcome = String(reply["outcome"] ?? "");
    return { success: true, message: TURN_MESSAGES[outcome] ?? "Recorded.", data: reply };
  }

  async function markLost(capsuleId: string, stored: StoredRuntimeSession, reason: string, wakeCoordinator: boolean) {
    await commit(capsuleId, `session-lost:${stored.generation ?? stored.tokenId}`, { type: "session.lost", reason, wakeCoordinator, at: at() },
      stored.actor ? { ...stored.actor } : RUNTIME_ACTOR);
  }

  return {
    start,

    turn(input: { capsuleId: string; prompt: string; steer?: boolean; commandId?: string }): Promise<RuntimeResult> {
      const supportsSteer = deps.adapters[live.get(input.capsuleId)?.provider ?? "codex"]?.supportsSteer ?? false;
      return turnCommand(input.capsuleId, { type: "turn.request", prompt: input.prompt, steer: input.steer === true, supportsSteer }, input.commandId);
    },

    /** True when this process holds the room's session: only then can a message become its turn. */
    isLive(capsuleId: string): boolean {
      return live.has(capsuleId);
    },

    /** A room message addressed to the session, as its next turn; the cursor moves past what it was handed. */
    deliver(input: { capsuleId: string; prompt: string; deliveredCursor: string; commandId?: string }): Promise<RuntimeResult> {
      return turnCommand(input.capsuleId, { type: "room-message.deliver", prompt: input.prompt, deliveredCursor: input.deliveredCursor, at: at() }, input.commandId);
    },

    async interrupt(capsuleId: string): Promise<RuntimeResult> {
      const result = await turnCommand(capsuleId, { type: "turn.interrupt" });
      return result.success ? { ...result, message: "Interrupt sent; the turn reports interrupted when it stops." } : result;
    },

    async stop(input: { capsuleId: string; reason: string; actor: WorkCapsuleActor }): Promise<RuntimeResult> {
      const entry = live.get(input.capsuleId);
      if (!entry) {
        const revoked = await deps.revokeTokens({ capsuleId: input.capsuleId, reason: input.reason });
        return { success: true, message: `No live session; revoked ${revoked} stale credential(s).`, data: { revoked } };
      }
      await commit(input.capsuleId, `session-stop:${entry.generation}`, { type: "session.stop", reason: input.reason, at: at() }, input.actor);
      return { success: true, message: `Stopping the ${entry.provider} runtime; its credential is revoked as it closes.` };
    },

    /** Settle a held question. It is durable, so it is decidable whether or not the session is live here. */
    async decide(input: { capsuleId: string; requestId: string; decision: RuntimeDecision; reason: string; actor: WorkCapsuleActor }): Promise<RuntimeResult> {
      const found = await held.find(input.capsuleId, input.requestId);
      if (!found) return refuse("not_found", `No held request ${input.requestId} on ${input.capsuleId}.`);
      const waiting = live.get(input.capsuleId)?.providerPending.has(input.requestId) === true;
      const settled = await held.settle({ capsuleId: input.capsuleId, requestId: input.requestId, decision: input.decision, decidedBy: input.actor.userId, reason: input.reason });
      if (settled !== "settled") {
        // Decided elsewhere (the inbox) while the Codex session still waits on it: pass that decision on.
        const recorded = DECISION_FOR_STATUS[found.status];
        if (!recorded || !waiting) return refuse("already_decided", `${input.requestId} was already decided or has expired (${found.status}).`);
        await commit(input.capsuleId, `request-decided:${input.requestId}:${randomUUID()}`, { type: "request.decided", requestId: input.requestId, decision: recorded,
          summary: found.request.summary, reason: "decided elsewhere", answerWaitingSession: true }, input.actor);
        return { success: true, message: `${input.requestId} was already decided ${recorded}; the waiting session is answered with that decision.` };
      }
      await commit(input.capsuleId, `request-decided:${input.requestId}:${randomUUID()}`, { type: "request.decided", requestId: input.requestId, decision: input.decision,
        summary: found.request.summary, reason: input.reason, answerWaitingSession: waiting }, input.actor);
      return { success: true, message: `Recorded ${input.decision} for ${input.requestId}. ${waiting ? "The waiting session is answered." : "The decision applies when the session asks again."}` };
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
      const request = { requestId, kind: "tool" as const, turnId: entry.session.activeTurnId(), summary, detail: input.toolInput };
      await held.hold({ capsuleId: input.capsuleId, provider: entry.provider, providerThreadId: entry.session.threadId(), actor: supervisionActor(entry.actor),
        request: { ...request, callKey, answeredBy: "re-ask" }, reason: verdict.reason });
      await commit(input.capsuleId, `request-held:${requestId}`, { type: "request.held", request, reason: verdict.reason }, entry.actor);
      return { behavior: "deny", message: `Held for a room decision (request ${requestId}): ${verdict.reason}. Continue with other work, or ask again once it is decided.` };
    },

    async status(capsuleId: string) {
      const entry = live.get(capsuleId);
      const heldRequests = await held.listOpen(capsuleId);
      const stored = readStoredRuntimeSession((await loadRoom(capsuleId))?.workspaceState);
      const queued = stored?.queuedInputs?.length ?? 0;
      if (entry) {
        return { live: true, provider: entry.provider, threadId: entry.session.threadId(), activeTurnId: entry.session.activeTurnId(), held: heldRequests, queued };
      }
      return {
        live: false,
        ...(stored ? { supervision: stored.status, addressedAs: stored.addressedAs ?? null, ...(stored.lostReason ? { lostReason: stored.lostReason } : {}) } : {}),
        ...(queued > 0 ? { queued } : {}),
        ...(heldRequests.length > 0 ? { held: heldRequests } : {}),
      };
    },

    /** Run every runnable outbox effect now (boot, tests). */
    drainEffects: () => worker.drain(),
    /** Keep running effects every few seconds, for the portal process. */
    startEffectWorker: (intervalMs?: number) => worker.start(intervalMs),

    /**
     * Boot: re-attach every supervised session to its stored thread, as the
     * person who started it, in a new generation. No turn is started by the
     * re-attach itself, so nothing is spent; input the old process never
     * received runs once the session is open. A session that cannot resume is
     * marked supervision-lost on the room.
     */
    async reattachSupervised(): Promise<{ reattached: string[]; lost: string[]; closed: string[] }> {
      const outcome = { reattached: [] as string[], lost: [] as string[], closed: [] as string[] };
      // No provider process survived the restart: steps decided for one that is not coming back are retired first.
      await effects.retireOrphaned().catch((error: unknown) => {
        console.error("[workroom-runtime] boot retire failed: %s", describe(error));
      });
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
            await commit(room.capsuleId, `room-ended:${stored.generation ?? stored.tokenId}`, { type: "session.room-ended", at: at() }, RUNTIME_ACTOR);
            outcome.closed.push(room.capsuleId);
          } else {
            await markLost(room.capsuleId, stored, result.message, true);
            outcome.lost.push(room.capsuleId);
          }
        } catch (error) {
          console.error("[workroom-runtime] re-attach failed for %s: %s", JSON.stringify(room.capsuleId), describe(error));
        }
      }
      return outcome;
    },
  };
}

export type RuntimeSupervisor = ReturnType<typeof createRuntimeSupervisor>;
