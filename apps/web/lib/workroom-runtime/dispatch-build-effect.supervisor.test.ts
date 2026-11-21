import { beforeEach, describe, expect, it, vi } from "vitest";

// BI-EB4BB4A0: the `dispatch-build` effect on the real supervisor and effect
// worker, over the memory outbox fixture (whose rules match
// workroom-effect-store.ts). It proves the receiving side of the cutover:
// - the effect runs through the executor Build Studio registers;
// - its result is read back in the room log;
// - it is not process-bound, so a portal restart neither retires nor loses it;
// - with no registered executor it stays owed and retries, never dropped.

const { db } = vi.hoisted(() => ({ db: { workroom: { findUnique: vi.fn() } } }));
vi.mock("@dpf/db", () => ({ prisma: db }));

import { createMemoryHeldRequestStore } from "./__fixtures__/memory-held-request-store";
import { createMemoryRuntimeStore, type MemoryEffect } from "./__fixtures__/memory-runtime-store";
import { registerEffectExecutor, registeredEffectExecutor, kickWorkroomEffects } from "./effect-executors";
import { createRuntimeSupervisor } from "./supervisor";
import type { ExecutorDriver } from "@/lib/executor-drivers/types";

const NOW = new Date("2026-11-20T18:00:00.000Z");
let clock = NOW.getTime();
let room: { id: string; capsuleId: string; status: string; archivedAt: Date | null; workspaceState: Record<string, unknown>; taskRunId: string | null };
let store: ReturnType<typeof createMemoryRuntimeStore>;

function portal() {
  const adapter = { provider: "codex", capabilities: {}, openSession: vi.fn() } as unknown as ExecutorDriver;
  return createRuntimeSupervisor({
    adapters: { codex: adapter, claude: adapter },
    mcpUrl: "http://portal/api/mcp/v1",
    issueToken: vi.fn(async () => ({ tokenId: "tok-1", plaintext: "dpfroom_x" })),
    revokeTokens: vi.fn(async () => 0),
    held: createMemoryHeldRequestStore(),
    clientGaid: async () => "gaid:x",
    listSupervisedRooms: async () => [],
    now: () => new Date(clock),
    commit: store.commit,
    effects: store.effects,
  });
}

function oweDispatch(): MemoryEffect {
  const row: MemoryEffect = {
    id: "eff-dispatch", sequence: 1, ordinal: 0, workCapsuleId: room.id, capsuleId: room.capsuleId,
    commandKey: "build-dispatch:FB-1", kind: "dispatch-build", processBound: false, sessionGeneration: null,
    payload: { buildId: "FB-1", userId: "u1" }, status: "pending", attemptCount: 0, maxAttempts: 5, availableAt: clock, leaseExpiresAt: null,
  };
  store.effectRows.push(row);
  return row;
}

beforeEach(() => {
  vi.clearAllMocks();
  clock = NOW.getTime();
  (globalThis as { __dpfWorkroomEffectExecutors?: unknown }).__dpfWorkroomEffectExecutors = undefined;
  room = { id: "row-1", capsuleId: "WC-1", status: "working", archivedAt: null, workspaceState: {}, taskRunId: null };
  store = createMemoryRuntimeStore((capsuleId) => (capsuleId === "WC-1" ? room : null), () => clock);
  db.workroom.findUnique.mockImplementation(async () => room);
});

describe("dispatch-build on the Workroom effect worker", () => {
  it("runs once through the registered executor, settles succeeded, and the room log reads the dispatch back", async () => {
    const executor = vi.fn(async (_effect: unknown) => ({ outcome: "started", summary: "Dispatched build FB-1 to the build orchestrator." }));
    registerEffectExecutor("dispatch-build", executor);
    const row = oweDispatch();
    const runtime = portal();
    await runtime.drainEffects();
    await runtime.drainEffects();
    expect(executor).toHaveBeenCalledTimes(1);
    expect(executor.mock.calls[0]![0]).toMatchObject({ kind: "dispatch-build", capsuleId: "WC-1", payload: { buildId: "FB-1", userId: "u1" } });
    expect(row.status).toBe("succeeded");
    expect(store.activities).toEqual([expect.objectContaining({
      kind: "action", summary: "Dispatched build FB-1 to the build orchestrator.",
      payload: { kind: "build-dispatch", buildId: "FB-1", outcome: "started" },
    })]);
  });

  it("with no executor registered yet, the attempt fails and the effect stays owed for the backoff retry", async () => {
    const row = oweDispatch();
    await portal().drainEffects();
    expect(row.status).toBe("pending");
    expect(row.attemptCount).toBe(1);
    expect(row.availableAt).toBeGreaterThan(clock);

    // Registration lands (boot finished); the retry runs it.
    const executor = vi.fn(async () => ({ outcome: "started", summary: "Dispatched build FB-1 to the build orchestrator." }));
    registerEffectExecutor("dispatch-build", executor);
    clock = row.availableAt;
    await portal().drainEffects();
    expect(executor).toHaveBeenCalledTimes(1);
    expect(row.status).toBe("succeeded");
  });

  it("survives a portal restart: a new process neither retires nor loses the owed dispatch, and runs it", async () => {
    const row = oweDispatch();
    // The first process died before running it: a fresh supervisor (the restarted portal) boots.
    const restarted = portal();
    await restarted.reattachSupervised();
    expect(row.status).toBe("pending");
    const executor = vi.fn(async () => ({ outcome: "adopted", via: "recent-activity", summary: "Build FB-1 recorded progress in the last 15 minutes; adopted that run instead of starting another." }));
    registerEffectExecutor("dispatch-build", executor);
    await restarted.drainEffects();
    expect(executor).toHaveBeenCalledTimes(1);
    expect(row.status).toBe("succeeded");
    expect(store.activities[0]).toMatchObject({ kind: "action", payload: { outcome: "adopted" } });
  });

  it("a settled dispatch is never run again by a later sweep", async () => {
    const executor = vi.fn(async () => ({ outcome: "started", summary: "Dispatched build FB-1 to the build orchestrator." }));
    registerEffectExecutor("dispatch-build", executor);
    oweDispatch();
    const runtime = portal();
    for (let i = 0; i < 3; i += 1) await runtime.drainEffects();
    await portal().drainEffects();
    expect(executor).toHaveBeenCalledTimes(1);
  });
});

describe("effect-executors registry", () => {
  it("holds one executor per kind; a re-registration (dev reload) replaces it", () => {
    const a = vi.fn(async () => ({}));
    const b = vi.fn(async () => ({}));
    expect(registeredEffectExecutor("dispatch-build")).toBeNull();
    registerEffectExecutor("dispatch-build", a);
    registerEffectExecutor("dispatch-build", b);
    expect(registeredEffectExecutor("dispatch-build")).toBe(b);
  });

  it("kick drains this process's worker when it is up, and is a no-op before boot starts it", async () => {
    const holder = globalThis as { __dpfWorkroomRuntime?: { drainEffects(): Promise<number> } };
    const saved = holder.__dpfWorkroomRuntime;
    try {
      holder.__dpfWorkroomRuntime = undefined;
      expect(() => kickWorkroomEffects()).not.toThrow();
      const drainEffects = vi.fn(async () => 1);
      holder.__dpfWorkroomRuntime = { drainEffects };
      kickWorkroomEffects();
      expect(drainEffects).toHaveBeenCalledTimes(1);
    } finally {
      holder.__dpfWorkroomRuntime = saved;
    }
  });
});
