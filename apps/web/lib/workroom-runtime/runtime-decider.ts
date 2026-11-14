// BI-C64EDA33 (plan 2026-11-14-workroom-runtime-core, decision DI-BEAADBEEB92C):
// the Workroom runtime's decider. Pure: given the room's runtime record and one
// command, it says which log rows to write, what the record becomes and which
// effects the outbox runs. It does no I/O, so a decision and everything it
// implies commit together (runtime-commit.server.ts) and a retry of the same
// command replays the stored reply instead of acting twice.
//
// Input is never only on an effect: the turn being started is the record's
// `inFlight` and the rest wait in `queuedInputs`, so an effect retired with its
// process puts its input back in line instead of losing it, and a room
// message's cursor moves only when its turn actually starts.
//
// Pattern reproduced from T3 Code's OrchestratorV2 decide step
// (pingdotgg/t3code@24e77473, MIT); no T3 code is copied.

import type { WorkCapsuleActivityKind } from "@/lib/work-capsules";

import { decideCodexRequest } from "./runtime-request-policy";
import type { QueuedInput, StoredRuntimeSession, SupervisionActor } from "./supervised-session";
import type { RuntimeDecision, RuntimeEvent, RuntimeProvider, RuntimeRequest } from "./types";

export const EFFECT_KINDS = [
  "start-turn", "steer-turn", "interrupt-turn", "answer-request", "hold-request",
  "close-session", "revoke-token", "announce-supervision-lost", "record-plan-limit",
  // PR 3 (AC-5): a room's setup owed by its claim or adoption (room-setup-effects.server.ts).
  "ensure-workitem-anchor",
] as const;
export type EffectKind = (typeof EFFECT_KINDS)[number];

/** Effects that need the provider process they were decided for. */
const PROCESS_BOUND: ReadonlySet<EffectKind> = new Set([
  "start-turn", "steer-turn", "interrupt-turn", "answer-request", "hold-request", "close-session",
]);
export const isProcessBound = (kind: EffectKind) => PROCESS_BOUND.has(kind);

export type EffectIntent = { kind: EffectKind; payload: Record<string, unknown> };

/** "runtime": written by the runtime for the session's starter; "actor": by the caller. */
export type ActivityIntent = { kind: WorkCapsuleActivityKind; summary: string; payload: Record<string, unknown>; as: "runtime" | "actor" };

export type EffectSettlement = {
  effectId: string;
  attempt: number;
  status: "succeeded" | "failed" | "retired" | "pending";
  error?: string | null;
  retryAfterMs?: number;
};

export type Decision = {
  activities: ActivityIntent[];
  /** undefined leaves the room's runtime record as it is. */
  session?: StoredRuntimeSession;
  effects: EffectIntent[];
  /** Retire unsettled process-bound effects of every generation but this one (null: all of them). */
  retire?: { keepGeneration: string | null; reason: string };
  settle?: EffectSettlement;
  /** BI-C64EDA33 PR 2: the delivered room message's wake state, written in the same transaction. */
  messageWake?: RoomMessageWakeWrite;
  reply: Record<string, unknown>;
};

/** A room message's structuredPayload with its wake decided, for the message row it belongs to. */
export type RoomMessageWakeWrite = { messageRowId: string; structuredPayload: Record<string, unknown> };

export type RoomSnapshot = { session: StoredRuntimeSession | null };

/** BI-1687CCD2: a thread resumes only in its own CLI; another provider starts from the room log. */
export type RuntimeHandoff = { text: string; included: number; omitted: number; bytes: number; fromProvider: RuntimeProvider; fromThreadId: string | null };

export type RuntimeCommand =
  | { type: "session.open"; provider: RuntimeProvider; threadId: string; tokenId: string; cwd: string; actor: SupervisionActor;
    addressedAs: string | null; generation: string; hostId: string; reattach: boolean; prompt: string | null; handoff?: RuntimeHandoff | null; at: string }
  | { type: "turn.request"; prompt: string; steer: boolean; supportsSteer: boolean }
  | { type: "room-message.deliver"; prompt: string; deliveredCursor: string; at: string; wake?: RoomMessageWakeWrite | null }
  | { type: "turn.interrupt" }
  | { type: "session.stop"; reason: string; at: string }
  | { type: "session.lost"; reason: string; wakeCoordinator: boolean; at: string }
  | { type: "session.room-ended"; at: string }
  | { type: "runtime.event"; generation: string; event: RuntimeEvent; at: string }
  | { type: "request.held"; request: Pick<RuntimeRequest, "requestId" | "kind" | "summary">; reason: string }
  | { type: "request.decided"; requestId: string; decision: RuntimeDecision; summary: string; reason: string; answerWaitingSession: boolean }
  | { type: "effect.settled"; effectId: string; attempt: number; kind: EffectKind; payload: Record<string, unknown>;
    outcome: "succeeded" | "failed" | "retired"; final: boolean; result?: Record<string, unknown>; error?: string | null; retryAfterMs?: number };

type Settled = Extract<RuntimeCommand, { type: "effect.settled" }>;
type Ending = Extract<RuntimeCommand, { type: "session.stop" | "session.lost" | "session.room-ended" }>;

const none = (reply: Record<string, unknown> = {}): Decision => ({ activities: [], effects: [], reply });
const write = (as: ActivityIntent["as"]) => (kind: WorkCapsuleActivityKind, summary: string, payload: Record<string, unknown> = {}): ActivityIntent =>
  ({ kind, summary: summary.slice(0, 2000), payload, as });
const runtime = write("runtime");
const byActor = write("actor");

const busy = (s: StoredRuntimeSession) => Boolean(s.activeTurnId) || Boolean(s.inFlight);

/** The input being started goes back to the head of the line: its effect will never run. */
function requeueInFlight(s: StoredRuntimeSession): StoredRuntimeSession {
  return s.inFlight ? { ...s, inFlight: null, queuedInputs: [s.inFlight, ...(s.queuedInputs ?? [])] } : s;
}

/** Hand `input` to the provider: it is the record's in-flight input until the turn reports started. */
function send(s: StoredRuntimeSession, input: QueuedInput) {
  return { session: { ...s, inFlight: input }, effects: [{ kind: "start-turn" as const, payload: { prompt: input.prompt, commandId: input.commandId } }] };
}

/** A turn's input: start it when the session is idle, otherwise keep it, durably, for the next turn. */
function requestTurn(s: StoredRuntimeSession, input: QueuedInput) {
  if (busy(s)) return { session: { ...s, queuedInputs: [...(s.queuedInputs ?? []), input] }, effects: [] as EffectIntent[], outcome: "queued" as const };
  return { ...send(s, input), outcome: "started" as const };
}

/** When the session is idle, the oldest kept input becomes its next turn. */
function startNextQueued(s: StoredRuntimeSession): { session: StoredRuntimeSession; effects: EffectIntent[] } {
  const [head, ...rest] = s.queuedInputs ?? [];
  if (!head || busy(s) || s.status !== "supervised") return { session: s, effects: [] };
  return send({ ...s, queuedInputs: rest }, head);
}

/** The in-flight input reached the provider: its room message's cursor is now the session's. */
function started(s: StoredRuntimeSession, turnId: string | null): StoredRuntimeSession {
  const cursor = s.inFlight?.deliveredCursor;
  return { ...s, inFlight: null, activeTurnId: turnId ?? s.activeTurnId ?? null, ...(cursor ? { deliveredCursor: cursor } : {}) };
}

function decideEvent(s: StoredRuntimeSession, generation: string, event: RuntimeEvent, at: string): Decision {
  // A late event from a process that is no longer the room's session changes nothing.
  if (s.generation && s.generation !== generation) return none({ ignored: "stale-generation" });
  // After stop, loss or the room's end, what the closing process still says changes nothing.
  if (s.status !== "supervised") return none({ ignored: "not-supervised" });
  const provider = s.provider;
  switch (event.type) {
    case "turn-started":
      return { activities: [runtime("action", `${provider} started a turn`, { turnId: event.turnId, provider })],
        session: { ...started(s, event.turnId), activeTurnId: event.turnId, lastHeartbeatAt: at }, effects: [], reply: {} };
    case "message":
      return { activities: [runtime("response", event.text, { turnId: event.turnId, provider })], effects: [], reply: {} };
    case "turn-completed": {
      const failed = event.status === "failed";
      const next = startNextQueued({ ...s, activeTurnId: null, lastHeartbeatAt: at });
      return {
        activities: [runtime(failed ? "error" : "response", failed ? `Turn failed: ${event.error ?? "no detail"}` : `Turn ${event.status}.`,
          { turnId: event.turnId, status: event.status, provider })],
        session: next.session,
        effects: [...(failed ? [{ kind: "record-plan-limit" as const, payload: { provider, error: event.error ?? null } }] : []), ...next.effects],
        reply: {},
      };
    }
    case "runtime-request": {
      const { request } = event;
      const verdict = decideCodexRequest(request);
      if (verdict.verdict === "accept") {
        return { activities: [runtime("action", `Accepted: ${request.summary}`, { requestId: request.requestId, kind: request.kind, reason: verdict.reason })],
          effects: [{ kind: "answer-request", payload: { requestId: request.requestId, decision: "accept" } }], reply: {} };
      }
      // An earlier room decision may already cover it: the effect checks, then answers or holds it.
      return { activities: [], effects: [{ kind: "hold-request", payload: { request, reason: verdict.reason } }], reply: {} };
    }
    case "session-exited":
      return {
        activities: [runtime("error", `The ${provider} session ended: ${event.reason}.`, { code: event.code })],
        // Unsent input stays with the room for the next session.
        session: { ...requeueInFlight(s), status: "closed", closedAt: at, activeTurnId: null },
        effects: [{ kind: "revoke-token", payload: { tokenId: s.tokenId, reason: `session ended: ${event.reason}` } }],
        retire: { keepGeneration: null, reason: "the session ended" },
        reply: {},
      };
  }
}

/** A steer that did not land becomes the next turn instead. */
function steerFallback(s: StoredRuntimeSession | null, c: Settled, base: Decision): Decision {
  if (!s || s.status !== "supervised") return base;
  const turn = requestTurn(s, { commandId: `steer-fallback:${c.effectId}`, prompt: String(c.payload["prompt"] ?? "") });
  return { ...base, session: turn.session, effects: turn.effects };
}

function decideSucceeded(s: StoredRuntimeSession | null, c: Settled, base: Decision): Decision {
  const result = c.result ?? {};
  switch (c.kind) {
    case "start-turn":
      // The provider accepted the input; turn-started may already have said so.
      return s && s.inFlight?.commandId === c.payload["commandId"] ? { ...base, session: started(s, (result["turnId"] as string | null) ?? null) } : base;
    case "steer-turn":
      return result["steered"] === true
        ? { ...base, activities: [runtime("action", "Steered the turn in progress.", {})] }
        : steerFallback(s, c, base);
    case "hold-request": {
      const request = c.payload["request"] as RuntimeRequest | undefined;
      if (!request) return base;
      return { ...base, activities: [result["outcome"] === "approved"
        ? runtime("action", `Accepted by an earlier room decision: ${request.summary}`, { requestId: request.requestId, kind: request.kind })
        : runtime("question", `Held for a room decision: ${request.summary} (${String(c.payload["reason"] ?? "")}).`,
          { requestId: request.requestId, kind: request.kind, reason: c.payload["reason"] ?? null, decideWith: "drive_workroom_runtime action=decide" })] };
    }
    case "record-plan-limit":
      return typeof result["summary"] === "string"
        ? { ...base, activities: [runtime("error", result["summary"], { kind: "executor-plan-limit", provider: result["provider"] ?? null, resetAt: result["resetAt"] ?? null })] }
        : base;
    default:
      return base;
  }
}

function decideSettled(s: StoredRuntimeSession | null, c: Settled): Decision {
  const retrying = c.outcome === "failed" && !c.final;
  const settle: EffectSettlement = retrying
    ? { effectId: c.effectId, attempt: c.attempt, status: "pending", error: c.error ?? null, retryAfterMs: c.retryAfterMs ?? 1000 }
    : { effectId: c.effectId, attempt: c.attempt, status: c.outcome, error: c.error ?? null };
  const base: Decision = { activities: [], effects: [], settle, reply: { settled: settle.status } };
  if (retrying) return base;
  if (c.outcome === "succeeded") return decideSucceeded(s, c, base);
  const note = c.outcome === "retired"
    ? runtime("effect-retired", `Retired ${c.kind}: the session it was decided for is gone; its input waits for the next turn.`, { effectId: c.effectId, kind: c.kind })
    : runtime("error", `Runtime effect ${c.kind} failed: ${c.error ?? "no detail"}`, { effectId: c.effectId, kind: c.kind });
  if (c.kind === "steer-turn") return { ...steerFallback(s, c, base), activities: [note] };
  if (c.kind === "start-turn" && s && s.inFlight?.commandId === c.payload["commandId"]) {
    // Retired: the input goes back in line. Failed for good: it is dropped, said so above, and the next input runs.
    const released = c.outcome === "retired" ? requeueInFlight(s) : { ...s, inFlight: null };
    const next = c.outcome === "retired" ? { session: released, effects: [] } : startNextQueued(released);
    return { ...base, session: next.session, effects: next.effects, activities: [note] };
  }
  return { ...base, activities: [note] };
}

function decideOpen(s: StoredRuntimeSession | null, commandId: string, c: Extract<RuntimeCommand, { type: "session.open" }>): Decision {
  const activities: ActivityIntent[] = [];
  const effects: EffectIntent[] = [];
  if (s?.status === "supervised" && s.tokenId !== c.tokenId) {
    // Process-bound: the old session died with its process. Retire its credential; resume its thread.
    effects.push({ kind: "revoke-token", payload: { tokenId: s.tokenId, reason: "cancelled_after_process_loss" } });
    if (!c.reattach) {
      activities.push(byActor("error", `cancelled_after_process_loss: the ${s.provider} session ended with its process; resuming its thread.`, { stored: s }));
    }
  }
  const address = c.addressedAs ? ` Address it in the room as ${c.addressedAs}.` : "";
  activities.push((c.reattach ? runtime : byActor)("executor-changed", c.reattach
    ? `Re-attached the supervised ${c.provider} runtime to its thread after a portal restart.${address}`
    : `Opened a supervised ${c.provider} runtime.${address}`,
  { provider: c.provider, threadId: c.threadId, tokenId: c.tokenId, addressedAs: c.addressedAs }));
  const handoff = c.handoff && c.handoff.included > 0 ? c.handoff : null;
  if (handoff) {
    activities.push(runtime("action", `Handed the runtime thread from ${handoff.fromProvider} to ${c.provider}: ${handoff.included} log entries carried, ${handoff.omitted} left out.`,
      { fromProvider: handoff.fromProvider, fromThreadId: handoff.fromThreadId, toProvider: c.provider, included: handoff.included, omitted: handoff.omitted, bytes: handoff.bytes }));
  }
  // Unsent input is the room's, not the provider's: it carries across a resume and a provider switch, the in-flight one first.
  const kept = s ? requeueInFlight(s).queuedInputs ?? [] : [];
  const first = [handoff?.text ?? "", c.prompt?.trim() ?? ""].filter(Boolean).join("\n\n");
  const opened: StoredRuntimeSession = {
    provider: c.provider, threadId: c.threadId, tokenId: c.tokenId, status: "supervised", openedAt: c.at, cwd: c.cwd,
    actor: c.actor, addressedAs: c.addressedAs, lastHeartbeatAt: c.at,
    // The session keeps its place in the room across a resume of its own thread.
    deliveredCursor: s?.provider === c.provider ? s.deliveredCursor ?? null : null,
    queuedInputs: first ? [{ commandId: `${commandId}:first-turn`, prompt: first }, ...kept] : kept,
    generation: c.generation, hostId: c.hostId, activeTurnId: null, inFlight: null,
  };
  const next = startNextQueued(opened);
  return {
    activities, session: next.session, effects: [...effects, ...next.effects],
    retire: { keepGeneration: c.generation, reason: "a new session process replaced the one these were decided for" },
    reply: { threadId: c.threadId, addressedAs: c.addressedAs, queued: next.session.queuedInputs?.length ?? 0 },
  };
}

function decideEnd(s: StoredRuntimeSession, c: Ending): Decision {
  const ended = { ...s, activeTurnId: null, closedAt: c.at };
  switch (c.type) {
    case "session.stop":
      return {
        activities: [byActor("executor-changed", `Stopped the ${s.provider} runtime: ${c.reason}`, {})],
        session: { ...ended, status: "closed", queuedInputs: [], inFlight: null },
        retire: { keepGeneration: null, reason: "the session was stopped" },
        effects: [{ kind: "close-session", payload: {} }, { kind: "revoke-token", payload: { tokenId: s.tokenId, reason: c.reason } }],
        reply: { outcome: "stopped" },
      };
    case "session.lost":
      return {
        // Written as the person who started supervision; a record from before item D names nobody.
        activities: s.actor ? [runtime("error", `supervision-lost: the ${s.provider} session${s.addressedAs ? ` ${s.addressedAs}` : ""} could not be re-attached after a portal restart (${c.reason}). Messages addressed to it wait on the room cursor until the runtime is started again.`,
          { stored: s, reason: c.reason })] : [],
        session: { ...requeueInFlight(ended), status: "supervision-lost", lostReason: c.reason },
        retire: { keepGeneration: null, reason: "supervision of the session was lost" },
        effects: [
          { kind: "revoke-token", payload: { tokenId: s.tokenId, reason: `supervision-lost: ${c.reason}` } },
          { kind: "announce-supervision-lost", payload: { reason: c.reason, actingUserId: s.actor?.userId ?? null,
            addressedAs: s.addressedAs ?? null, wakeCoordinator: c.wakeCoordinator } },
        ],
        reply: { outcome: "lost" },
      };
    case "session.room-ended":
      return {
        activities: [], session: { ...ended, status: "closed", inFlight: null },
        retire: { keepGeneration: null, reason: "the room ended" },
        effects: [{ kind: "revoke-token", payload: { tokenId: s.tokenId, reason: "room ended" } }],
        reply: { outcome: "closed" },
      };
  }
}

export function decideRuntimeCommand(room: RoomSnapshot, commandId: string, command: RuntimeCommand): Decision {
  const s = room.session;
  switch (command.type) {
    case "session.open":
      return decideOpen(s, commandId, command);
    case "turn.request": {
      if (s?.status !== "supervised") return none({ outcome: "no-session" });
      if (command.steer && command.supportsSteer && s.activeTurnId) {
        return { activities: [], effects: [{ kind: "steer-turn", payload: { prompt: command.prompt } }], reply: { outcome: "steer-requested" } };
      }
      const turn = requestTurn(s, { commandId, prompt: command.prompt });
      return { activities: [], session: turn.session, effects: turn.effects,
        reply: { outcome: turn.outcome, ...(turn.outcome === "queued" ? { queued: turn.session.queuedInputs?.length ?? 0 } : {}) } };
    }
    case "room-message.deliver": {
      if (s?.status !== "supervised") return none({ outcome: "no-session" });
      // The cursor moves when this turn starts, so a message whose turn never ran stays readable from it.
      const turn = requestTurn(s, { commandId, prompt: command.prompt, deliveredCursor: command.deliveredCursor });
      return {
        activities: [runtime("action", "A room message addressed to this session was handed to it as a turn.", { outcome: turn.outcome })],
        session: { ...turn.session, lastHeartbeatAt: command.at }, effects: turn.effects, reply: { outcome: turn.outcome },
        ...(command.wake ? { messageWake: command.wake } : {}),
      };
    }
    case "turn.interrupt":
      if (!s) return none({ outcome: "no-session" });
      return { activities: [], session: { ...s, queuedInputs: [] }, effects: [{ kind: "interrupt-turn", payload: {} }], reply: { outcome: "interrupt-requested" } };
    case "session.stop":
    case "session.lost":
    case "session.room-ended":
      return s ? decideEnd(s, command) : none({ outcome: "no-session" });
    case "runtime.event":
      return s ? decideEvent(s, command.generation, command.event, command.at) : none({ ignored: "no-session" });
    case "request.held":
      return { activities: [runtime("question", `Held for a room decision: ${command.request.summary} (${command.reason}).`,
        { requestId: command.request.requestId, kind: command.request.kind, reason: command.reason, decideWith: "drive_workroom_runtime action=decide" })], effects: [], reply: {} };
    case "request.decided":
      return {
        activities: [byActor("response", `Decided ${command.decision}: ${command.summary} (${command.reason})`, { requestId: command.requestId, decision: command.decision })],
        effects: command.answerWaitingSession ? [{ kind: "answer-request", payload: { requestId: command.requestId, decision: command.decision } }] : [],
        reply: { answered: command.answerWaitingSession },
      };
    case "effect.settled":
      return decideSettled(s, command);
  }
}
