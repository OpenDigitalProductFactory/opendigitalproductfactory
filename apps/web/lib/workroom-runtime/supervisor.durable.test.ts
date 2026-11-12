import { beforeEach, describe, expect, it, vi } from "vitest";

// BI-F5D58F29 (agent dialog broker item D, §7.1): supervision outlives the
// portal process. A second supervisor over the same room and the same held
// store stands in for the portal after a restart.

const { db, recordActivity } = vi.hoisted(() => ({
  db: { workroom: { findUnique: vi.fn(), update: vi.fn() }, $executeRaw: vi.fn() },
  recordActivity: vi.fn(async (..._args: unknown[]) => ({ id: "act" })),
}));
vi.mock("@dpf/db", () => ({ prisma: db }));
vi.mock("@/lib/work-capsules/work-capsule-activity-store", () => ({ recordWorkCapsuleActivity: recordActivity }));

import { createMemoryHeldRequestStore } from "./__fixtures__/memory-held-request-store";
import { createRuntimeSupervisor, REATTACH_HORIZON_MS, type RuntimeSupervisorDeps } from "./supervisor";
import type { ExecutorAdapter, RuntimeEvent, RuntimeSession } from "./types";

const NOW = new Date("2026-11-11T05:00:00.000Z");
const actor = { userId: "user-1", agentId: "agent-1", principalId: "prn-1" };
const GAID = "gaid:priv:dpf.internal:agt-ext-codex";
let room: { id: string; capsuleId: string; status: string; archivedAt: Date | null; workspaceState: Record<string, unknown>; taskRunId: string | null };

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
    ...over,
  });
  return { runtime, session, adapter, held, onSupervisionLost, revokeTokens, emit: (event: RuntimeEvent) => emit(event) };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const stored = () => room.workspaceState["runtimeSession"] as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  room = { id: "row-1", capsuleId: "WC-1", status: "working", archivedAt: null, workspaceState: {}, taskRunId: "TR-1" };
  db.workroom.findUnique.mockImplementation(async () => room);
  db.workroom.update.mockImplementation(async ({ data }: { data: { workspaceState: Record<string, unknown> } }) => { room.workspaceState = data.workspaceState; return room; });
  // writeSession sets only the runtimeSession key: jsonb_set(..., ${json}::jsonb) WHERE id = ${roomId}.
  db.$executeRaw.mockImplementation(async (_sql: TemplateStringsArray, json: string) => { room.workspaceState = { ...room.workspaceState, runtimeSession: JSON.parse(json) }; return 1; });
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
    expect(recordActivity.mock.calls.some((call) => String((call as unknown as [unknown, { summary: string }])[1].summary).includes(`${GAID}#session=thr-1`))).toBe(true);
  });

  it("delivers a turn, moves the cursor, and queues behind a running turn", async () => {
    const before = portal();
    await before.runtime.start({ capsuleId: "WC-1", provider: "codex", actor });
    await expect(before.runtime.deliver({ capsuleId: "WC-1", prompt: "room says hi", deliveredCursor: "cur-1" })).resolves.toMatchObject({ data: { outcome: "started" } });
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
    const oldToken = stored()["tokenId"];

    const after = portal(before.held);
    expect(after.runtime.isLive("WC-1")).toBe(false);
    await expect(after.runtime.reattachSupervised()).resolves.toEqual({ reattached: ["WC-1"], lost: [], closed: [] });
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
    expect(after.adapter.openSession).not.toHaveBeenCalled();
    expect(after.revokeTokens).toHaveBeenCalledWith(expect.objectContaining({ tokenId: "tok-old" }));
  });

  it("marks a session long silent lost without waking anyone", async () => {
    const stale = new Date(NOW.getTime() - REATTACH_HORIZON_MS - 1).toISOString();
    room.workspaceState = { runtimeSession: { provider: "codex", threadId: "t", tokenId: "k", status: "supervised", openedAt: stale, lastHeartbeatAt: stale, cwd: "/workspace", actor } };
    const after = portal();
    await after.runtime.reattachSupervised();
    expect(after.adapter.openSession).not.toHaveBeenCalled();
    expect(after.onSupervisionLost).toHaveBeenCalledWith(expect.objectContaining({ wakeCoordinator: false }));
  });

  it("closes, quietly, a session whose room ended while the portal was down", async () => {
    const before = portal();
    await before.runtime.start({ capsuleId: "WC-1", provider: "codex", actor });
    room.status = "complete";
    const after = portal(before.held);
    await expect(after.runtime.reattachSupervised()).resolves.toMatchObject({ closed: ["WC-1"] });
    expect(stored()).toMatchObject({ status: "closed" });
    expect(after.onSupervisionLost).not.toHaveBeenCalled();
  });
});

describe("a held request survives the restart and is still decidable (AC-3)", () => {
  it("a Codex request: decided after the restart, the same request asked again passes", async () => {
    const before = portal();
    await before.runtime.start({ capsuleId: "WC-1", provider: "codex", actor });
    before.emit({ type: "runtime-request", request: { requestId: "r-push", kind: "command", turnId: "t", summary: "git push origin feat", detail: {} } });
    await flush();
    expect(before.session.respondToRuntimeRequest).not.toHaveBeenCalled();

    const after = portal(before.held);
    await expect(after.runtime.status("WC-1")).resolves.toMatchObject({ held: [{ requestId: "r-push" }] });
    await expect(after.runtime.decide({ capsuleId: "WC-1", requestId: "r-push", decision: "accept", reason: "release branch", actor }))
      .resolves.toMatchObject({ success: true, message: expect.stringContaining("asks again") });
    await expect(after.runtime.decide({ capsuleId: "WC-1", requestId: "r-push", decision: "decline", reason: "x", actor })).resolves.toMatchObject({ error: "already_decided" });

    await after.runtime.reattachSupervised();
    after.emit({ type: "runtime-request", request: { requestId: "r-push-2", kind: "command", turnId: "t2", summary: "git push origin feat", detail: {} } });
    await flush();
    expect(after.session.respondToRuntimeRequest).toHaveBeenCalledWith("r-push-2", "accept");
  });

  it("an approval covers that request only, and only for the person it was asked of", async () => {
    const before = portal();
    await before.runtime.start({ capsuleId: "WC-1", provider: "codex", actor });
    const fileChange = (requestId: string, path: string) => ({ type: "runtime-request" as const, request: { requestId, kind: "permission" as const, turnId: "t", summary: "widen its access", detail: { path } } });
    before.emit(fileChange("r-a", "/etc/hosts"));
    await flush();
    await before.runtime.decide({ capsuleId: "WC-1", requestId: "r-a", decision: "accept", reason: "ok", actor });
    before.emit(fileChange("r-b", "/root/.ssh"));
    await flush();
    expect(before.session.respondToRuntimeRequest).not.toHaveBeenCalledWith("r-b", "accept");

    await before.runtime.stop({ capsuleId: "WC-1", reason: "handover", actor });
    const other = portal(before.held);
    await other.runtime.start({ capsuleId: "WC-1", provider: "codex", actor: { ...actor, userId: "user-2" } });
    other.emit(fileChange("r-c", "/etc/hosts"));
    await flush();
    expect(other.session.respondToRuntimeRequest).not.toHaveBeenCalledWith("r-c", "accept");
  });

  it("a Codex request decided from the inbox is passed on to the waiting session", async () => {
    const h = portal();
    await h.runtime.start({ capsuleId: "WC-1", provider: "codex", actor });
    h.emit({ type: "runtime-request", request: { requestId: "r-in", kind: "command", turnId: "t", summary: "git push origin x", detail: {} } });
    await flush();
    h.held.rows.find((r) => r.request.requestId === "r-in")!.status = "declined"; // the inbox route's decision
    await expect(h.runtime.decide({ capsuleId: "WC-1", requestId: "r-in", decision: "accept", reason: "late", actor }))
      .resolves.toMatchObject({ success: true, message: expect.stringContaining("already decided decline") });
    expect(h.session.respondToRuntimeRequest).toHaveBeenCalledWith("r-in", "decline");
  });

  it("a live Codex request is answered at once when decided", async () => {
    const h = portal();
    await h.runtime.start({ capsuleId: "WC-1", provider: "codex", actor });
    h.emit({ type: "runtime-request", request: { requestId: "r-1", kind: "command", turnId: "t", summary: "curl https://x", detail: {} } });
    await flush();
    await h.runtime.decide({ capsuleId: "WC-1", requestId: "r-1", decision: "decline", reason: "no network", actor });
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
    await expect(after.runtime.claudePermission({ capsuleId: "WC-1", toolName: "WebFetch", toolInput: { url: "https://x" } })).resolves.toMatchObject({ behavior: "allow" });
  });
});
