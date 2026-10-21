// BI-6DBA2238: the agent-task dispatcher runs due tasks concurrently up to the
// coworker's concurrency limit and the free provider slots, isolates one task's
// failure from the batch, and re-checks quiescence before each task starts.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findTasks: vi.fn(),
  findAgents: vi.fn(),
  execute: vi.fn(),
  level: vi.fn(),
  pools: vi.fn(),
  cliStats: vi.fn(),
}));

vi.mock("@/lib/jobs", () => ({
  jobs: { createFunction: (config: unknown, handler: unknown) => ({ config, handler }) },
}));
vi.mock("@/lib/jobs/triggers", () => ({ cron: (expr: string) => ({ cron: expr }) }));
vi.mock("../quiescence-gates", () => ({ gateAtEntry: async () => ({ proceed: true }) }));
vi.mock("@/lib/backlog/acceptance-sweep/acceptance-upgrade-wakeup", () => ({
  reconcileAcceptanceUpgradeWakeupFromStore: async () => ({ outcome: "noop" }),
}));
vi.mock("@/lib/operate/scheduled-jobs/coworker-self-task-sweep", () => ({
  reconcileAllCoworkerSelfTasks: async () => ({ ok: true }),
}));
vi.mock("@dpf/db", () => ({
  prisma: {
    scheduledAgentTask: { findMany: (...a: unknown[]) => mocks.findTasks(...a) },
    agent: { findMany: (...a: unknown[]) => mocks.findAgents(...a) },
  },
}));
vi.mock("@/lib/actions/agent-task-scheduler", () => ({
  executeScheduledAgentTask: (...a: unknown[]) => mocks.execute(...a),
}));
vi.mock("@/lib/self-upgrade/quiescence", () => ({ getQuiescenceLevel: () => mocks.level() }));
vi.mock("@/lib/routing/cli-pool-status", () => ({ getAllCliPoolStatuses: () => mocks.pools() }));
vi.mock("@/lib/routing/cli-concurrency", () => ({ cliConcurrencyStats: () => mocks.cliStats() }));

import { agentTaskDispatch } from "./agent-task-dispatch";

type Handler = (ctx: { step: { run: (id: string, fn: () => unknown) => Promise<unknown> } }) => Promise<unknown>;
const handler = (agentTaskDispatch as unknown as { handler: Handler }).handler;
const step = { run: vi.fn(async (_id: string, f: () => unknown) => f()) };

function tasks(...rows: Array<[string, string]>) {
  return rows.map(([taskId, agentId]) => ({ taskId, agentId }));
}

/**
 * Execute mock that records the peak number of tasks running at once, per agent.
 * Each task holds until `holdUntil` tasks are running (or 1 s passes), so the
 * peak measures what the dispatcher allows rather than module-load timing.
 */
function trackConcurrency(agentOf: Record<string, string>, holdUntil: number) {
  const running = new Map<string, number>();
  const peak = new Map<string, number>();
  let total = 0;
  let peakTotal = 0;
  mocks.execute.mockImplementation(async (taskId: string) => {
    const agent = agentOf[taskId]!;
    running.set(agent, (running.get(agent) ?? 0) + 1);
    total++;
    peak.set(agent, Math.max(peak.get(agent) ?? 0, running.get(agent)!));
    peakTotal = Math.max(peakTotal, total);
    const deadline = Date.now() + 1_000;
    while (total < holdUntil && Date.now() < deadline) await new Promise((r) => setTimeout(r, 5));
    running.set(agent, running.get(agent)! - 1);
    total--;
  });
  return { peak, peakTotal: () => peakTotal };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.level.mockResolvedValue("normal");
  mocks.pools.mockResolvedValue([]);
  mocks.cliStats.mockReturnValue({ inFlight: 0, queued: 0, max: 4 });
  mocks.findAgents.mockResolvedValue([]);
  mocks.execute.mockResolvedValue(undefined);
});

describe("agent task dispatch", () => {
  it("keeps the per-run bound of 20 due tasks", async () => {
    mocks.findTasks.mockResolvedValue([]);
    await handler({ step });
    expect(mocks.findTasks).toHaveBeenCalledWith(expect.objectContaining({ take: 20 }));
  });

  it("runs one coworker's tasks concurrently up to its concurrency limit, not one at a time", async () => {
    const due = tasks(["t1", "build-specialist"], ["t2", "build-specialist"], ["t3", "build-specialist"], ["t4", "build-specialist"]);
    mocks.findTasks.mockResolvedValue(due);
    mocks.findAgents.mockResolvedValue([{ agentId: "AGT-WS-BUILD", executionConfig: { concurrencyLimit: 2 } }]);
    const seen = trackConcurrency(Object.fromEntries(due.map((t) => [t.taskId, t.agentId])), 3);

    const result = await handler({ step });

    expect(seen.peak.get("build-specialist")).toBe(2);
    expect(mocks.execute).toHaveBeenCalledTimes(4);
    expect(result).toMatchObject({ dispatched: 4, failed: 0, lanes: 2 });
  });

  it("never runs more tasks at once than the provider pool has free slots", async () => {
    const due = tasks(["a", "x1"], ["b", "x2"], ["c", "x3"], ["d", "x4"], ["e", "x5"]);
    mocks.findTasks.mockResolvedValue(due);
    mocks.findAgents.mockResolvedValue(due.map((t) => ({ agentId: t.agentId, executionConfig: { concurrencyLimit: 8 } })));
    mocks.cliStats.mockReturnValue({ inFlight: 1, queued: 0, max: 4 });
    const seen = trackConcurrency(Object.fromEntries(due.map((t) => [t.taskId, t.agentId])), 4);

    await handler({ step });

    expect(seen.peakTotal()).toBe(3);
    expect(mocks.execute).toHaveBeenCalledTimes(5);
  });

  it("runs serially when the pool reports a provider exhausted", async () => {
    const due = tasks(["a", "x1"], ["b", "x2"], ["c", "x3"]);
    mocks.findTasks.mockResolvedValue(due);
    mocks.findAgents.mockResolvedValue(due.map((t) => ({ agentId: t.agentId, executionConfig: { concurrencyLimit: 8 } })));
    mocks.pools.mockResolvedValue([{ isExhausted: true, weeklyUtilization: null, weeklyObservedAt: null }]);
    const seen = trackConcurrency(Object.fromEntries(due.map((t) => [t.taskId, t.agentId])), 2);

    await handler({ step });

    expect(seen.peakTotal()).toBe(1);
  });

  it("isolates a failing task: the rest of the batch still runs", async () => {
    mocks.findTasks.mockResolvedValue(tasks(["a", "x"], ["b", "x"], ["c", "x"]));
    mocks.execute.mockImplementation(async (taskId: string) => {
      if (taskId === "b") throw new Error("inference blew up");
    });

    const result = await handler({ step });

    expect(mocks.execute.mock.calls.map((c) => c[0])).toEqual(["a", "b", "c"]);
    expect(result).toMatchObject({ dispatched: 2, failed: 1 });
  });

  it("stops starting tasks once a drain begins mid-batch", async () => {
    mocks.findTasks.mockResolvedValue(tasks(["a", "x"], ["b", "x"], ["c", "x"]));
    // Entry gate passed; the first task starts under "normal", then the drain begins.
    mocks.level.mockResolvedValueOnce("normal").mockResolvedValue("draining");

    const result = await handler({ step });

    expect(mocks.execute.mock.calls.map((c) => c[0])).toEqual(["a"]);
    expect(result).toMatchObject({ dispatched: 1, notStarted: 2, quiesced: "draining" });
  });
});
