import { describe, expect, it } from "vitest";

// BI-C64EDA33 (AC-1): runtime commands are decided without I/O. The decider is
// a pure function of the room's runtime record and one command.

import { decideRuntimeCommand, isProcessBound, type RuntimeCommand } from "./runtime-decider";
import type { StoredRuntimeSession } from "./supervised-session";

const AT = "2026-11-14T05:00:00.000Z";
const actor = { userId: "user-1", agentId: "agent-1", principalId: "prn-1" };
const session = (over: Partial<StoredRuntimeSession> = {}): StoredRuntimeSession => ({
  provider: "codex", threadId: "thr-1", tokenId: "tok-1", status: "supervised", openedAt: AT, cwd: "/workspace", actor,
  addressedAs: "gaid:x#session=thr-1", deliveredCursor: null, generation: "gen-1", hostId: "host-1",
  queuedInputs: [], activeTurnId: null, turnPending: false, ...over,
});
const decide = (s: StoredRuntimeSession | null, command: RuntimeCommand, id = "cmd-1") => decideRuntimeCommand({ session: s }, id, command);
const open = (over: Partial<Extract<RuntimeCommand, { type: "session.open" }>> = {}): RuntimeCommand => ({
  type: "session.open", provider: "codex", threadId: "thr-1", tokenId: "tok-2", cwd: "/workspace", actor, addressedAs: "gaid:x#session=thr-1",
  generation: "gen-2", hostId: "host-2", reattach: false, prompt: null, at: AT, ...over,
});

describe("decideRuntimeCommand", () => {
  it("is pure: the same record and command give the same decision, and the record is not mutated", () => {
    const s = session({ activeTurnId: "turn-1" });
    const frozen = JSON.stringify(s);
    const command: RuntimeCommand = { type: "turn.request", prompt: "next", steer: false, supportsSteer: true };
    expect(decide(s, command)).toEqual(decide(s, command));
    expect(JSON.stringify(s)).toBe(frozen);
  });

  it("starts a turn when idle and keeps input durably when busy", () => {
    const idle = decide(session(), { type: "turn.request", prompt: "go", steer: false, supportsSteer: true });
    expect(idle.effects).toEqual([{ kind: "start-turn", payload: { prompt: "go" } }]);
    expect(idle.session).toMatchObject({ turnPending: true });
    const busy = decide(session({ activeTurnId: "turn-1" }), { type: "turn.request", prompt: "later", steer: false, supportsSteer: true }, "cmd-2");
    expect(busy.effects).toEqual([]);
    expect(busy.session?.queuedInputs).toEqual([{ commandId: "cmd-2", prompt: "later" }]);
    expect(busy.reply).toEqual({ outcome: "queued", queued: 1 });
  });

  it("steers a running turn only when the provider can, and runs the input next when the steer fails", () => {
    expect(decide(session({ activeTurnId: "turn-1" }), { type: "turn.request", prompt: "s", steer: true, supportsSteer: true }).effects)
      .toEqual([{ kind: "steer-turn", payload: { prompt: "s" } }]);
    expect(decide(session({ activeTurnId: "turn-1" }), { type: "turn.request", prompt: "s", steer: true, supportsSteer: false }).reply)
      .toMatchObject({ outcome: "queued" });
    const fallback = decide(session({ activeTurnId: "turn-1" }), { type: "effect.settled", effectId: "e1", attempt: 1, kind: "steer-turn",
      payload: { prompt: "s" }, outcome: "succeeded", final: true, result: { steered: false } });
    expect(fallback.session?.queuedInputs).toEqual([{ commandId: "steer-fallback:e1", prompt: "s" }]);
    expect(fallback.settle).toMatchObject({ effectId: "e1", status: "succeeded" });
  });

  it("starts the oldest kept input when a turn completes, and records a failed turn's plan limit", () => {
    const s = session({ activeTurnId: "turn-1", queuedInputs: [{ commandId: "a", prompt: "first" }, { commandId: "b", prompt: "second" }] });
    const done = decide(s, { type: "runtime.event", generation: "gen-1", event: { type: "turn-completed", turnId: "turn-1", status: "failed", error: "usage limit" }, at: AT });
    expect(done.effects).toEqual([
      { kind: "record-plan-limit", payload: { provider: "codex", error: "usage limit" } },
      { kind: "start-turn", payload: { prompt: "first" } },
    ]);
    expect(done.session).toMatchObject({ activeTurnId: null, turnPending: true, queuedInputs: [{ commandId: "b", prompt: "second" }] });
    expect(done.activities[0]).toMatchObject({ kind: "error", as: "runtime" });
  });

  it("ignores events from another generation or after the session ended", () => {
    const event: RuntimeCommand = { type: "runtime.event", generation: "gen-old", event: { type: "message", turnId: null, text: "late" }, at: AT };
    expect(decide(session(), event)).toMatchObject({ activities: [], effects: [], reply: { ignored: "stale-generation" } });
    expect(decide(session({ status: "closed" }), { ...event, generation: "gen-1" } as RuntimeCommand).reply).toEqual({ ignored: "not-supervised" });
  });

  it("answers in-sandbox requests and holds the rest for the room", () => {
    const ask = (summary: string) => decide(session(), { type: "runtime.event", generation: "gen-1", at: AT,
      event: { type: "runtime-request", request: { requestId: "r", kind: "command", turnId: "t", summary, detail: {} } } });
    expect(ask("pnpm test").effects).toEqual([{ kind: "answer-request", payload: { requestId: "r", decision: "accept" } }]);
    expect(ask("git push origin main").effects[0]).toMatchObject({ kind: "hold-request" });
  });

  it("a new process retires the old one's effects, keeps its place and its unsent input, and runs the input first", () => {
    const s = session({ deliveredCursor: "cur-9", queuedInputs: [{ commandId: "q", prompt: "unsent" }] });
    const d = decide(s, open({ reattach: true }));
    expect(d.retire).toMatchObject({ keepGeneration: "gen-2" });
    expect(d.effects).toEqual([
      { kind: "revoke-token", payload: { tokenId: "tok-1", reason: "cancelled_after_process_loss" } },
      { kind: "start-turn", payload: { prompt: "unsent" } },
    ]);
    expect(d.session).toMatchObject({ generation: "gen-2", deliveredCursor: "cur-9", queuedInputs: [], turnPending: true });
    // A re-attach is the runtime's own act, not the caller's: no cancelled_after_process_loss notice.
    expect(d.activities.map((a) => a.kind)).toEqual(["executor-changed"]);
  });

  it("stop, loss and the room's end retire every process-bound effect and revoke the credential", () => {
    for (const command of [
      { type: "session.stop", reason: "done", at: AT },
      { type: "session.lost", reason: "gone", wakeCoordinator: true, at: AT },
      { type: "session.room-ended", at: AT },
    ] as RuntimeCommand[]) {
      const d = decide(session(), command);
      expect(d.retire).toMatchObject({ keepGeneration: null });
      expect(d.effects).toContainEqual(expect.objectContaining({ kind: "revoke-token" }));
      expect(d.session?.status).not.toBe("supervised");
    }
  });

  it("settles effects: a failure is retried until final, and a dead turn releases the session", () => {
    const retry = decide(session({ turnPending: true }), { type: "effect.settled", effectId: "e1", attempt: 1, kind: "start-turn", payload: {},
      outcome: "failed", final: false, error: "boom", retryAfterMs: 2000 });
    expect(retry).toMatchObject({ settle: { status: "pending", retryAfterMs: 2000 }, activities: [] });
    expect(retry.session).toBeUndefined();
    const retired = decide(session({ turnPending: true, queuedInputs: [{ commandId: "q", prompt: "next" }] }), { type: "effect.settled",
      effectId: "e1", attempt: 1, kind: "start-turn", payload: {}, outcome: "retired", final: true });
    expect(retired.settle?.status).toBe("retired");
    expect(retired.activities[0]?.kind).toBe("effect-retired");
    expect(retired.effects).toEqual([{ kind: "start-turn", payload: { prompt: "next" } }]);
  });

  it("marks exactly the effects that need their provider process as process-bound", () => {
    expect(["start-turn", "steer-turn", "interrupt-turn", "answer-request", "hold-request", "close-session"].every((k) => isProcessBound(k as never))).toBe(true);
    expect(["revoke-token", "announce-supervision-lost", "record-plan-limit"].some((k) => isProcessBound(k as never))).toBe(false);
  });
});
