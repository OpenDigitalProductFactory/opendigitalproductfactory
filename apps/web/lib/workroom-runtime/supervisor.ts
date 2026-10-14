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
// A live session is process-bound (§4.6): it lives in this process. The room
// stores the provider thread, so after a restart the next start records the
// lost session as cancelled_after_process_loss, revokes its credential, and
// resumes the same provider thread.

import { createHash, randomUUID } from "node:crypto";

import { prisma } from "@dpf/db";
import { recordWorkCapsuleActivity } from "@/lib/work-capsules/work-capsule-activity-store";
import type { CapsuleDb, WorkCapsuleActor } from "@/lib/work-capsules/work-capsule-store-types";
import type { WorkCapsuleActivityKind } from "@/lib/work-capsules";
import { TERMINAL_WORKROOM_STATUSES } from "@/lib/work-management/standing-room-nesting";

import { decideClaudeToolCall, decideCodexRequest } from "./runtime-request-policy";
import type { ExecutorAdapter, RuntimeDecision, RuntimeEvent, RuntimeProvider, RuntimeRequest, RuntimeSession } from "./types";

export const DEFAULT_RUNTIME_CWD = "/workspace";

export type StoredRuntimeSession = {
  provider: RuntimeProvider;
  threadId: string | null;
  tokenId: string;
  status: "open" | "closed";
  openedAt: string;
  closedAt?: string;
  cwd: string;
};

type LiveSession = {
  capsuleId: string;
  roomId: string;
  provider: RuntimeProvider;
  session: RuntimeSession;
  tokenId: string;
  cwd: string;
  actor: WorkCapsuleActor;
  /** Questions held for a room decision, by request id. */
  held: Map<string, RuntimeRequest & { claudeKey?: string }>;
  /** Claude tool calls a room decision accepted; asked again, they pass. */
  approvedClaudeCalls: Set<string>;
  /** Input that arrived while a turn ran and could not steer it. */
  queued: string[];
  /** Log writes, in event order. */
  writes: Promise<unknown>;
};

export type RuntimeSupervisorDeps = {
  adapters: Partial<Record<RuntimeProvider, ExecutorAdapter>>;
  mcpUrl: string;
  issueToken(input: { userId: string; agentId: string | null; capsuleId: string; runRef: string | null }): Promise<{ tokenId: string; plaintext: string }>;
  revokeTokens(input: { capsuleId: string; reason: string; tokenId?: string }): Promise<number>;
  now?: () => Date;
};

export type RuntimeResult = { success: boolean; error?: string; message: string; data?: Record<string, unknown> };

const refuse = (error: string, message: string): RuntimeResult => ({ success: false, error, message });

export function readStoredRuntimeSession(workspaceState: unknown): StoredRuntimeSession | null {
  if (!workspaceState || typeof workspaceState !== "object" || Array.isArray(workspaceState)) return null;
  const stored = (workspaceState as Record<string, unknown>)["runtimeSession"];
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return null;
  const record = stored as Record<string, unknown>;
  if ((record["provider"] !== "codex" && record["provider"] !== "claude") || typeof record["tokenId"] !== "string") return null;
  return {
    provider: record["provider"],
    threadId: typeof record["threadId"] === "string" ? record["threadId"] : null,
    tokenId: record["tokenId"],
    status: record["status"] === "open" ? "open" : "closed",
    openedAt: typeof record["openedAt"] === "string" ? record["openedAt"] : "",
    cwd: typeof record["cwd"] === "string" ? record["cwd"] : DEFAULT_RUNTIME_CWD,
  };
}

function claudeCallKey(toolName: string, input: Record<string, unknown>): string {
  return createHash("sha256").update(`${toolName}\n${JSON.stringify(input)}`).digest("hex").slice(0, 32);
}

export function createRuntimeSupervisor(deps: RuntimeSupervisorDeps) {
  const live = new Map<string, LiveSession>();
  const clock = deps.now ?? (() => new Date());

  async function loadRoom(capsuleId: string) {
    return prisma.workroom.findUnique({
      where: { capsuleId },
      select: { id: true, status: true, archivedAt: true, workspaceState: true, taskRunId: true },
    });
  }

  async function storeSession(roomId: string, session: StoredRuntimeSession | null) {
    const room = await prisma.workroom.findUnique({ where: { id: roomId }, select: { workspaceState: true } });
    const state = room?.workspaceState && typeof room.workspaceState === "object" && !Array.isArray(room.workspaceState)
      ? room.workspaceState as Record<string, unknown> : {};
    await prisma.workroom.update({ where: { id: roomId }, data: { workspaceState: { ...state, runtimeSession: session } as never } });
  }

  /** The runtime records as the person who opened it, attributed to the runtime agent. */
  const runtimeActor = (actor: WorkCapsuleActor): WorkCapsuleActor => ({ ...actor, agentId: "workroom-runtime" });

  function log(roomId: string, kind: WorkCapsuleActivityKind, summary: string, payload: Record<string, unknown>, actor: WorkCapsuleActor) {
    return recordWorkCapsuleActivity(prisma as unknown as CapsuleDb, { workCapsuleId: roomId, kind, summary: summary.slice(0, 2000), payload, actor });
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
    await storeSession(entry.roomId, {
      provider: entry.provider, threadId: entry.session.threadId(), tokenId: entry.tokenId, status: "closed",
      openedAt: "", closedAt: clock().toISOString(), cwd: entry.cwd,
    });
  }

  function onEvent(entry: LiveSession, event: RuntimeEvent) {
    const { roomId } = entry;
    switch (event.type) {
      case "turn-started":
        enqueue(entry, () => log(roomId, "action", `${entry.provider} started a turn`, { turnId: event.turnId, provider: entry.provider }, runtimeActor(entry.actor)));
        return;
      case "message":
        enqueue(entry, () => log(roomId, "response", event.text, { turnId: event.turnId, provider: entry.provider }, runtimeActor(entry.actor)));
        return;
      case "turn-completed":
        enqueue(entry, () => log(roomId, event.status === "failed" ? "error" : "response",
          event.status === "failed" ? `Turn failed: ${event.error ?? "no detail"}` : `Turn ${event.status}.`,
          { turnId: event.turnId, status: event.status, provider: entry.provider }, runtimeActor(entry.actor)));
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
        entry.held.set(request.requestId, request);
        enqueue(entry, () => log(roomId, "question", `Held for a room decision: ${request.summary} (${verdict.reason}).`,
          { requestId: request.requestId, kind: request.kind, reason: verdict.reason, decideWith: "drive_workroom_runtime action=decide" }, runtimeActor(entry.actor)));
        return;
      }
      case "session-exited":
        enqueue(entry, () => log(roomId, "error", `The ${entry.provider} session ended: ${event.reason}.`, { code: event.code }, runtimeActor(entry.actor)));
        void finish(entry, `session ended: ${event.reason}`).catch(() => {});
        return;
    }
  }

  async function start(input: { capsuleId: string; provider: RuntimeProvider; actor: WorkCapsuleActor; prompt?: string; model?: string | null; cwd?: string }): Promise<RuntimeResult> {
    const adapter = deps.adapters[input.provider];
    if (!adapter) return refuse("provider_unavailable", `No ${input.provider} runtime is configured on this install.`);
    if (live.has(input.capsuleId)) return refuse("already_running", `${input.capsuleId} already has a live runtime session; stop it first.`);
    const room = await loadRoom(input.capsuleId);
    if (!room) return refuse("not_found", `Workroom ${input.capsuleId} not found.`);
    if (room.archivedAt || TERMINAL_WORKROOM_STATUSES.has(room.status)) {
      return refuse("room_terminal", `Workroom ${input.capsuleId} is ${room.status}; it cannot open a runtime.`);
    }
    const stored = readStoredRuntimeSession(room.workspaceState);
    if (stored?.status === "open") {
      // Process-bound (§4.6): the session died with its process. Say so, retire its credential, resume its thread.
      await deps.revokeTokens({ capsuleId: input.capsuleId, reason: "cancelled_after_process_loss", tokenId: stored.tokenId });
      await log(room.id, "error", `cancelled_after_process_loss: the ${stored.provider} session ended with its process; resuming its thread.`, { stored }, runtimeActor(input.actor));
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
      actor: input.actor, held: new Map(), approvedClaudeCalls: new Set(), queued: [], writes: Promise.resolve(),
    };
    live.set(input.capsuleId, entry);
    entryRef.current = entry;
    for (const event of pendingEvents) onEvent(entry, event);
    try {
      const threadId = await session.ensureThread();
      await storeSession(room.id, { provider: input.provider, threadId, tokenId: token.tokenId, status: "open", openedAt: clock().toISOString(), cwd });
      await log(room.id, "executor-changed", `Opened a supervised ${input.provider} runtime.`, { provider: input.provider, threadId, tokenId: token.tokenId }, input.actor);
      if (input.prompt?.trim()) await session.startTurn(input.prompt.trim());
      return { success: true, message: `${input.provider} runtime open on ${input.capsuleId}.`, data: { capsuleId: input.capsuleId, provider: input.provider, threadId } };
    } catch (error) {
      await session.close().catch(() => {});
      await finish(entry, "session failed to start");
      return refuse("runtime_unavailable", `The ${input.provider} runtime could not open its thread: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  function liveOr(capsuleId: string): LiveSession | RuntimeResult {
    return live.get(capsuleId)
      ?? refuse("no_session", `${capsuleId} has no live runtime session in this process; start one (it resumes the room's thread).`);
  }
  const isLive = (value: LiveSession | RuntimeResult): value is LiveSession => "session" in value;

  return {
    start,

    async turn(input: { capsuleId: string; prompt: string; steer?: boolean }): Promise<RuntimeResult> {
      const entry = liveOr(input.capsuleId);
      if (!isLive(entry)) return entry;
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
    },

    async interrupt(capsuleId: string): Promise<RuntimeResult> {
      const entry = liveOr(capsuleId);
      if (!isLive(entry)) return entry;
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

    async decide(input: { capsuleId: string; requestId: string; decision: RuntimeDecision; reason: string; actor: WorkCapsuleActor }): Promise<RuntimeResult> {
      const entry = liveOr(input.capsuleId);
      if (!isLive(entry)) return entry;
      const held = entry.held.get(input.requestId);
      if (!held) return refuse("not_found", `No held request ${input.requestId} on ${input.capsuleId}.`);
      entry.held.delete(input.requestId);
      if (held.claudeKey) {
        if (input.decision === "accept") entry.approvedClaudeCalls.add(held.claudeKey);
      } else {
        await entry.session.respondToRuntimeRequest(input.requestId, input.decision);
      }
      await log(entry.roomId, "response", `Decided ${input.decision}: ${held.summary} (${input.reason})`, { requestId: input.requestId, decision: input.decision }, input.actor);
      return { success: true, message: `Recorded ${input.decision} for ${input.requestId}.` };
    },

    /** Claude's --permission-prompt-tool, answered for the room the calling credential is bound to. */
    async claudePermission(input: { capsuleId: string; toolName: string; toolInput: Record<string, unknown> }):
      Promise<{ behavior: "allow"; updatedInput: Record<string, unknown> } | { behavior: "deny"; message: string }> {
      const entry = live.get(input.capsuleId);
      if (!entry) return { behavior: "deny", message: "This room has no live runtime session." };
      const key = claudeCallKey(input.toolName, input.toolInput);
      const verdict = entry.approvedClaudeCalls.has(key)
        ? { verdict: "accept" as const, reason: "the room decided to allow it" }
        : decideClaudeToolCall({ toolName: input.toolName, input: input.toolInput, cwd: entry.cwd });
      if (verdict.verdict === "accept") return { behavior: "allow", updatedInput: input.toolInput };
      const requestId = `req-${randomUUID().slice(0, 8)}`;
      const summary = `${input.toolName} ${JSON.stringify(input.toolInput).slice(0, 300)}`;
      entry.held.set(requestId, { requestId, kind: "tool", turnId: entry.session.activeTurnId(), summary, detail: input.toolInput, claudeKey: key });
      enqueue(entry, () => log(entry.roomId, "question", `Held for a room decision: ${summary} (${verdict.reason}).`,
        { requestId, kind: "tool", reason: verdict.reason, decideWith: "drive_workroom_runtime action=decide" }, runtimeActor(entry.actor)));
      return { behavior: "deny", message: `Held for a room decision (request ${requestId}): ${verdict.reason}. Continue with other work, or ask again once it is decided.` };
    },

    status(capsuleId: string) {
      const entry = live.get(capsuleId);
      return entry
        ? { live: true, provider: entry.provider, threadId: entry.session.threadId(), activeTurnId: entry.session.activeTurnId(),
          held: [...entry.held.values()].map(({ requestId, kind, summary }) => ({ requestId, kind, summary })), queued: entry.queued.length }
        : { live: false };
    },
  };
}

export type RuntimeSupervisor = ReturnType<typeof createRuntimeSupervisor>;
