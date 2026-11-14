import { beforeEach, describe, expect, it, vi } from "vitest";

// BI-F5D58F29 (agent dialog broker item D, §7.1): supervision outlives the
// portal process. A second supervisor over the same room, the same held store
// and the same room outbox stands in for the portal after a restart.
// BI-C64EDA33: effects decided for the old process are retired, not replayed,
// and input it never received stays queued (AC-4).

const { db } = vi.hoisted(() => ({ db: { workroom: { findUnique: vi.fn() } } }));
vi.mock("@dpf/db", () => ({ prisma: db }));

import { createMemoryHeldRequestStore } from "./__fixtures__/memory-held-request-store";
import { createMemoryRuntimeStore } from "./__fixtures__/memory-runtime-store";
import { createRuntimeSupervisor, REATTACH_HORIZON_MS, type RuntimeSupervisorDeps } from "./supervisor";
import type { ExecutorAdapter, RuntimeEvent, RuntimeSession } from "./types";

const NOW = new Date("2026-11-11T05:00:00.000Z");
const actor = { userId: "user-1", agentId: "agent-1", principalId: "prn-1" };
const GAID = "gaid:priv:dpf.internal:agt-ext-codex";
let room: { id: string; capsuleId: string; status: string; archivedAt: Date | null; workspaceState: Record<string, unknown>; taskRunId: string | null };
let store: ReturnType<typeof createMemoryRuntimeStore>;

function portal(held = createMemoryHeldRequestStore(), over: Partial<RuntimeSupervisorDeps> = {}) {
  let emit: (event: RuntimeEvent) => void = () => {};
  const session = {
    provider: "codex" as const,
    turn: null as string | null,
    threadId: () => "thr-1",
    activeTurnId: () => session.turn,
    ensureThread: vi.fn(async () => "thr-1"),
    startTurn: vi.fn(async () => { session.turn = "turn-1"; return { turnId: "turn-1" }; }),
    steerTurn: vi.fn(async () => false),
    interruptTurn: vi.fn(async () => {}),
    respondToRuntimeRequest: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
  const adapter: ExecutorAdapter = {
    provider: "codex", supportsSteer: false,
    openSession: vi.fn(async (_config, onEvent) => { emit = onEvent; return session as unknown as RuntimeSession; }),
  };
  const onSupervisionLost = vi.fn(async () => {});
  const revokeTokens = vi.fn(async () => 1);
  const runtime = createRuntimeSupervisor({
    adapters: { codex: adapter, claude: adapter },
    mcpUrl: "http://portal/api/mcp/v1",
    issueToken: vi.fn(async () => ({ tokenId: `tok-${Math.random().toString(36).slice(2, 6)}`, plaintext: "dpfroom_x" })),
    revokeTokens,
    held,
    clientGaid: async () => GAID,
    listSupervisedRooms: async () => [{ capsuleId: room.capsuleId, workspaceState: room.workspaceState }],
    onSupervisionLost,
    now: () => NOW,
    commit: store.commit,
    effects: store.effects,
    ...over,
  });
  const settle = async () => {
    for (let i = 0; i < 4; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await runtime.drainEffects();
    }
  };
  return { runtime, session, adapter, held, onSupervisionLost, revokeTokens, settle, emit: (event: RuntimeEvent) => emit(event) };
}

const stored = () => room.workspaceState["runtimeSession"] as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  room = { id: "row-1", capsuleId: "WC-1", status: "working", archivedAt: null, workspaceState: {}, taskRunId: "TR-1" };
  store = createMemoryRuntimeStore((capsuleId) => (capsuleId === "WC-1" ? room : null), () => NOW.getTime());
  db.workroom.findUnique.mockImplementation(async () => room);
});

describe("the supervision record", () => {
  it("stores who started it and the address a room message names it by", async () => {
    const before = portal();
    const result = await before.runtime.start({ capsuleId: "WC-1", provider: "codex", actor });
    expect(result.data).toMatchObject({ addressedAs: `${GAID}#session=thr-1` });
    expect(stored()).toMatchObject({
      status: "supervised", addressedAs: `${GAID}#session=thr-1`, lastHeartbeatAt: NOW.toISOString(),
      actor: { userId: "user-1", agentId: "agent-1", principalId: "prn-1" },
    });
    expect(store.activities.some((a) => a.summary.includes(`${GAID}#session=thr-1`))).toBe(true);
  });

  it("delivers a turn, moves the cursor, and queues behind a running turn", async () => {
    const before = portal();
    await before.runtime.start({ capsuleId: "WC-1", provider: "codex", actor });
    await expect(before.runtime.deliver({ capsuleId: "WC-1", prompt: "room says hi", deliveredCursor: "cur-1" })).resolves.toMatchObject({ data: { outcome: "started" } });
    await before.settle();
    expect(before.session.startTurn).toHaveBeenCalledWith("room says hi");
    expect(stored()).toMatchObject({ deliveredCursor: "cur-1" });
    await expect(before.runtime.deliver({ capsuleId: "WC-1", prompt: "and again", deliveredCursor: "cur-2" })).resolves.toMatchObject({ data: { outcome: "queued" } });
    await expect(before.runtime.deliver({ capsuleId: "WC-2", prompt: "x", deliveredCursor: "c" })).resolves.toMatchObject({ error: "no_session" });
  });
});

describe("after a portal restart (AC-ADB-13)", () => {
  it("re-attaches a supervised session to its thread as the person who started it, starting no turn", async () => {
    const before = portal();
    await before.runtime.start({ capsuleId: "WC-1", provider: "codex", actor });
    await before.runtime.deliver({ capsuleId: "WC-1", prompt: "x", deliveredCursor: "cur-1" });
    await before.settle();
    const oldToken = stored()["tokenId"];

    const after = portal(before.held);
    expect(after.runtime.isLive("WC-1")).toBe(false);
    await expect(after.runtime.reattachSupervised()).resolves.toEqual({ reattached: ["WC-1"], lost: [], closed: [] });
    await after.settle();
    expect(after.runtime.isLive("WC-1")).toBe(true);
    expect(after.adapter.openSession).toHaveBeenCalledWith(expect.objectContaining({ resumeThreadId: "thr-1" }), expect.any(Function));
    expect(after.revokeTokens).toHaveBeenCalledWith(expect.objectContaining({ tokenId: oldToken }));
    expect(after.session.startTurn).not.toHaveBeenCalled();
    expect(stored()).toMatchObject({ status: "supervised", deliveredCursor: "cur-1", actor: { userId: "user-1" } });
  });

  it("marks a session it cannot resume supervision-lost and wakes the coordinator", async () => {
    const before = portal();
    await before.runtime.start({ capsuleId: "WC-1", provider: "codex", actor });
    const after = portal(before.held, { adapters: {} });
    await expect(after.runtime.reattachSupervised()).resolves.toMatchObject({ lost: ["WC-1"] });
    await after.settle();
    expect(stored()).toMatchObject({ status: "supervision-lost", lostReason: expect.stringContaining("No codex runtime") });
    expect(after.onSupervisionLost).toHaveBeenCalledWith(expect.objectContaining({
      capsuleId: "WC-1", actingUserId: "user-1", addressedAs: `${GAID}#session=thr-1`, wakeCoordinator: true,
    }));
    await expect(after.runtime.status("WC-1")).resolves.toMatchObject({ live: false, supervision: "supervision-lost" });
  });

  it("marks a session stored before item D, with no starting person, lost", async () => {
    room.workspaceState = { runtimeSession: { provider: "codex", threadId: "thr-old", tokenId: "tok-old", status: "open", openedAt: NOW.toISOString(), cwd: "/workspace" } };
    const after = portal();
    await expect(after.runtime.reattachSupervised()).resolves.toMatchObject({ lost: ["WC-1"] });
    await after.settle();
    expect(after.adapter.openSession).not.toHaveBeenCalled();
    expect(after.revokeTokens).toHaveBeenCalledWith(expect.objectContaining({ tokenId: "tok-old" }));
  });

  it("marks a session long silent lost without waking anyone", async () => {
    const stale = new Date(NOW.getTime() - REATTACH_HORIZON_MS - 1).toISOString();
    room.workspaceState = { runtimeSession: { provider: "codex", threadId: "t", tokenId: "k", status: "supervised", openedAt: stale, lastHeartbeatAt: stale, cwd: "/workspace", actor } };
    const after = portal();
    await after.runtime.reattachSupervised();
    await after.settle();
    expect(after.adapter.openSession).not.toHaveBeenCalled();
    expect(after.onSupervisionLost).toHaveBeenCalledWith(expect.objectContaining({ wakeCoordinator: false }));
  });

  it("closes, quietly, a session whose room ended while the portal was down", async () => {
    const before = portal();
    await before.runtime.start({ capsuleId: "WC-1", provider: "codex", actor });
    room.status = "complete";
    const after = portal(before.held);
    await expect(after.runtime.reattachSupervised()).resolves.toMatchObject({ closed: ["WC-1"] });
    await after.settle();
    expect(stored()).toMatchObject({ status: "closed" });
    expect(after.onSupervisionLost).not.toHaveBeenCalled();
  });
});

describe("a held request survives the restart and is still decidable (AC-3)", () => {
  it("a Codex request: decided after the restart, the same request asked again passes", async () => {
    const before = portal();
    await before.runtime.start({ capsuleId: "WC-1", provider: "codex", actor });
    before.emit({ type: "runtime-request", request: { requestId: "r-push", kind: "command", turnId: "t", summary: "git push origin feat", detail: {} } });
    await before.settle();
    expect(before.session.respondToRuntimeRequest).not.toHaveBeenCalled();

    const after = portal(before.held);
    await expect(after.runtime.status("WC-1")).resolves.toMatchObject({ held: [{ requestId: "r-push" }] });
    await expect(after.runtime.decide({ capsuleId: "WC-1", requestId: "r-push", decision: "accept", reason: "release branch", actor }))
      .resolves.toMatchObject({ success: true, message: expect.stringContaining("asks again") });
    await expect(after.runtime.decide({ capsuleId: "WC-1", requestId: "r-push", decision: "decline", reason: "x", actor })).resolves.toMatchObject({ error: "already_decided" });

    await after.runtime.reattachSupervised();
    await after.settle();
    after.emit({ type: "runtime-request", request: { requestId: "r-push-2", kind: "command", turnId: "t2", summary: "git push origin feat", detail: {} } });
    await after.settle();
    expect(after.session.respondToRuntimeRequest).toHaveBeenCalledWith("r-push-2", "accept");
  });

  it("an approval covers that request only, and only for the person it was asked of", async () => {
    const before = portal();
    await before.runtime.start({ capsuleId: "WC-1", provider: "codex", actor });
    const fileChange = (requestId: string, path: string) => ({ type: "runtime-request" as const, request: { requestId, kind: "permission" as const, turnId: "t", summary: "widen its access", detail: { path } } });
    before.emit(fileChange("r-a", "/etc/hosts"));
    await before.settle();
    await before.runtime.decide({ capsuleId: "WC-1", requestId: "r-a", decision: "accept", reason: "ok", actor });
    before.emit(fileChange("r-b", "/root/.ssh"));
    await before.settle();
    expect(before.session.respondToRuntimeRequest).not.toHaveBeenCalledWith("r-b", "accept");

    await before.runtime.stop({ capsuleId: "WC-1", reason: "handover", actor });
    await before.settle();
    const other = portal(before.held);
    await other.runtime.start({ capsuleId: "WC-1", provider: "codex", actor: { ...actor, userId: "user-2" } });
    other.emit(fileChange("r-c", "/etc/hosts"));
    await other.settle();
    expect(other.session.respondToRuntimeRequest).not.toHaveBeenCalledWith("r-c", "accept");
  });

  it("a Codex request decided from the inbox is passed on to the waiting session", async () => {
    const h = portal();
    await h.runtime.start({ capsuleId: "WC-1", provider: "codex", actor });
    h.emit({ type: "runtime-request", request: { requestId: "r-in", kind: "command", turnId: "t", summary: "git push origin x", detail: {} } });
    await h.settle();
    h.held.rows.find((r) => r.request.requestId === "r-in")!.status = "declined"; // the inbox route's decision
    await expect(h.runtime.decide({ capsuleId: "WC-1", requestId: "r-in", decision: "accept", reason: "late", actor }))
      .resolves.toMatchObject({ success: true, message: expect.stringContaining("already decided decline") });
    await h.settle();
    expect(h.session.respondToRuntimeRequest).toHaveBeenCalledWith("r-in", "decline");
  });

  it("a live Codex request is answered at once when decided", async () => {
    const h = portal();
    await h.runtime.start({ capsuleId: "WC-1", provider: "codex", actor });
    h.emit({ type: "runtime-request", request: { requestId: "r-1", kind: "command", turnId: "t", summary: "curl https://x", detail: {} } });
    await h.settle();
    await h.runtime.decide({ capsuleId: "WC-1", requestId: "r-1", decision: "decline", reason: "no network", actor });
    await h.settle();
    expect(h.session.respondToRuntimeRequest).toHaveBeenCalledWith("r-1", "decline");
  });

  it("a Claude call approved after the restart passes when asked again", async () => {
    const before = portal();
    await before.runtime.start({ capsuleId: "WC-1", provider: "claude", actor });
    await expect(before.runtime.claudePermission({ capsuleId: "WC-1", toolName: "WebFetch", toolInput: { url: "https://x" } })).resolves.toMatchObject({ behavior: "deny" });
    const [row] = before.held.rows;

    const after = portal(before.held);
    await after.runtime.decide({ capsuleId: "WC-1", requestId: row!.request.requestId, decision: "accept", reason: "docs", actor });
    await after.runtime.reattachSupervised();
    await after.settle();
    await expect(after.runtime.claudePermission({ capsuleId: "WC-1", toolName: "WebFetch", toolInput: { url: "https://x" } })).resolves.toMatchObject({ behavior: "allow" });
  });
});

describe("the room outbox across a restart (BI-C64EDA33, AC-4)", () => {
  it("retires effects decided for the dead process, keeps unsent input queued, and runs it once the session is back", async () => {
    const before = portal();
    await before.runtime.start({ capsuleId: "WC-1", provider: "codex", actor, prompt: "first" });
    await before.settle();
    before.emit({ type: "turn-started", turnId: "turn-1" });
    await before.settle();
    // The portal dies while turn-1 runs: the next input is kept, never sent.
    await before.runtime.turn({ capsuleId: "WC-1", prompt: "unsent" });
    // And a step it was running when it died (an answer to its provider) never finished.
    before.session.respondToRuntimeRequest.mockImplementationOnce(() => new Promise<void>(() => {}));
    before.emit({ type: "runtime-request", request: { requestId: "r-local", kind: "command", turnId: "turn-1", summary: "pnpm test", detail: {} } });
    for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    const answer = store.effectRows.find((e) => e.kind === "answer-request")!;
    // Decided, and not yet answered (still queued, or in flight) when the process died.
    expect(["pending", "running"]).toContain(answer.status);
    expect(stored()["queuedInputs"]).toEqual([expect.objectContaining({ prompt: "unsent" })]);

    const after = portal(before.held);
    await after.runtime.reattachSupervised();
    await after.settle();
    // The dead process's answer is retired, not replayed into the new session.
    expect(answer.status).toBe("retired");
    expect(after.session.respondToRuntimeRequest).not.toHaveBeenCalled();
    expect(store.kinds()).toContain("effect-retired");
    // The kept input runs as the re-attached session's first turn.
    expect(after.session.startTurn).toHaveBeenCalledWith("unsent");
    expect(stored()).toMatchObject({ queuedInputs: [], status: "supervised" });
  });

  it("a retried command acts once: the same command id replays its reply and adds no effect", async () => {
    const h = portal();
    await h.runtime.start({ capsuleId: "WC-1", provider: "codex", actor });
    await h.settle();
    const first = await h.runtime.turn({ capsuleId: "WC-1", prompt: "once", commandId: "cmd-1" });
    const again = await h.runtime.turn({ capsuleId: "WC-1", prompt: "once", commandId: "cmd-1" });
    expect(again).toEqual(first);
    await h.settle();
    expect(h.session.startTurn).toHaveBeenCalledTimes(1);
    expect(store.effectRows.filter((e) => e.kind === "start-turn")).toHaveLength(1);
  });

  it("input handed to an idle session is not lost when the portal dies before its turn starts", async () => {
    const before = portal();
    await before.runtime.start({ capsuleId: "WC-1", provider: "codex", actor });
    await before.settle();
    // The turn is decided, and the portal dies before the worker sends it.
    before.session.startTurn.mockImplementationOnce(() => new Promise(() => {}));
    await before.runtime.deliver({ capsuleId: "WC-1", prompt: "room says hi", deliveredCursor: "cur-1" });
    expect(stored()).toMatchObject({ inFlight: { prompt: "room says hi", deliveredCursor: "cur-1" }, deliveredCursor: null });

    const after = portal(before.held);
    await after.runtime.reattachSupervised();
    await after.settle();
    expect(after.session.startTurn).toHaveBeenCalledWith("room says hi");
    expect(store.effectRows.filter((e) => e.kind === "start-turn" && e.status === "retired")).toHaveLength(1);
    after.emit({ type: "turn-started", turnId: "turn-9" });
    await after.settle();
    // The room message's cursor moves only once its turn really started.
    expect(stored()).toMatchObject({ deliveredCursor: "cur-1", inFlight: null, activeTurnId: "turn-9" });
  });

  it("a stop decided just before a crash still revokes the credential after the restart", async () => {
    const before = portal();
    await before.runtime.start({ capsuleId: "WC-1", provider: "codex", actor });
    await before.settle();
    const token = stored()["tokenId"];
    // The stop commits; the portal dies before the worker closes the session.
    before.session.close.mockImplementationOnce(() => new Promise(() => {}));
    await before.runtime.stop({ capsuleId: "WC-1", reason: "done", actor });

    const after = portal(before.held);
    await after.runtime.reattachSupervised();
    await after.settle();
    expect(store.effectRows.find((e) => e.kind === "close-session")?.status).toBe("retired");
    expect(after.revokeTokens).toHaveBeenCalledWith(expect.objectContaining({ tokenId: token, reason: "done" }));
    expect(store.effectRows.every((e) => !["pending", "running"].includes(e.status))).toBe(true);
  });
});
