import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ run: null as any, nodes: new Map<string, any>(), artifacts: new Map<string, any>(), queue: Promise.resolve(), cancelAfterIntent: false, commissionValid: true }));
const db = vi.hoisted(() => ({
  $queryRaw: vi.fn(async () => []),
  $transaction: vi.fn(async (write: any) => {
    const prior = state.queue;
    let release!: () => void;
    state.queue = new Promise<void>(resolve => { release = resolve; });
    await prior;
    try { return await write(db); } finally { if (state.cancelAfterIntent) { state.run.status = "canceled"; state.cancelAfterIntent = false; } release(); }
  }),
  scheduledAgentTask: { update: vi.fn(async () => ({})) },
  taskRun: {
    updateMany: vi.fn(async ({ where, data }: any) => { if (!state.run || state.run.taskRunId !== where.taskRunId || state.run.status !== where.status) return { count: 0 }; Object.assign(state.run, data); return { count: 1 }; }),
    findUnique: vi.fn(async () => state.run ? structuredClone(state.run) : null),
    findUniqueOrThrow: vi.fn(async () => { if (!state.run) throw new Error("missing"); return structuredClone(state.run); }),
    findFirst: vi.fn(async () => null),
    update: vi.fn(async ({ data }: any) => { Object.assign(state.run, data); return structuredClone(state.run); }),
  },
  taskNode: {
    findFirst: vi.fn(async () => [...state.nodes.values()][0] ?? null),
    create: vi.fn(async ({ data }: any) => { const row = { id: data.taskNodeId, ...data }; state.nodes.set(row.id, row); return row; }),
    findUnique: vi.fn(async ({ where }: any) => state.nodes.get(where.taskNodeId) ?? null),
    findUniqueOrThrow: vi.fn(async ({ where }: any) => state.nodes.get(where.id)),
    update: vi.fn(async ({ where, data }: any) => Object.assign(state.nodes.get(where.id), data)),
    updateMany: vi.fn(async ({ where, data }: any) => { const n = state.nodes.get(where.id); if (n.status !== where.status) return { count: 0 }; Object.assign(n, data); return { count: 1 }; }),
  },
  taskArtifact: {
    findFirst: vi.fn(async ({ where }: any) => [...state.artifacts.values()].reverse().find(row => row.taskRunId === where.taskRunId && row.name === where.name) ?? null),
    findUnique: vi.fn(async ({ where }: any) => state.artifacts.get(where.artifactId) ?? null),
    findUniqueOrThrow: vi.fn(async ({ where }: any) => { const row = state.artifacts.get(where.artifactId); if (!row) throw new Error("missing artifact"); return row; }),
    upsert: vi.fn(async ({ where, create }: any) => { if (!state.artifacts.has(where.artifactId)) state.artifacts.set(where.artifactId, create); return state.artifacts.get(where.artifactId); }),
  },
}));
vi.mock("@dpf/db", () => ({ prisma: db }));
vi.mock("@/lib/agent-toolchain/served-toolchain", () => ({ getInstallationDeviceId: async () => "did-test" }));
vi.mock("@/lib/tak/autonomous-work-run", () => ({ createAutonomousWorkRun: async (input: any) => {
  await input.admissionGuard?.(db);
  if (state.run) throw Object.assign(new Error("duplicate"), { code: "P2002" });
  state.run = { id: "row-1", taskRunId: input.taskRunId, userId: input.userId, status: "working", a2aMetadata: input.metadata, progressPayload: null };
  await input.afterTaskCreated?.(db, state.run);
} }));
vi.mock("@/lib/actions/agent-task-claim", () => ({ lockCurrentScheduledTask: async () => state.commissionValid, withCurrentScheduledTask: async (_db: unknown, _commission: unknown, _run: unknown, write: any) => state.commissionValid ? db.$transaction(write) : null }));
import { executeDurableReview } from "./durable-review-store";
import { emptyRoutingSummary } from "./route-review-findings";
import type { ReviewLine } from "./measures";
const line: ReviewLine = { lineKey: "one", scope: "wwmd", measureKey: "volume", professionKey: null, headline: "Count", evidence: { count: 2 }, proposedAction: "no-action" };
const options = () => ({ commission: { taskId: "weekly", taskRunId: null }, task: { taskId: "weekly", ownerUserId: "owner", agentId: "agent", schedule: "0 6 * * 1" }, periodKey: "2026-W45", now: new Date("2026-11-02T06:00:00Z"), measure: vi.fn(async () => [line]), route: vi.fn(async () => emptyRoutingSummary()), prepare: vi.fn(async () => ({ kind: "report" })), reconcile: vi.fn(async () => undefined) });
beforeEach(() => { state.run = null; state.nodes.clear(); state.artifacts.clear(); state.queue = Promise.resolve(); state.cancelAfterIntent = false; state.commissionValid = true; vi.clearAllMocks(); });
describe("durable review integration", () => {
  it("publishes one frozen result and replays without another attempt", async () => {
    const input = options();
    await expect(executeDurableReview(input)).resolves.toBe(true);
    const completedAt = state.run.completedAt;
    await expect(executeDurableReview({ ...input, now: new Date("2026-11-03") })).resolves.toBe(true);
    expect(input.measure).toHaveBeenCalledTimes(1);
    expect(input.route).toHaveBeenCalledTimes(1);
    expect(state.nodes.size).toBe(1);
    expect(state.run.completedAt).toEqual(completedAt);
    expect(state.run.progressPayload.correctionCoverage).toBe("unverified");
  });
  it("only admits one concurrent attempt", async () => {
    const input = options();
    const results = await Promise.all([executeDurableReview(input), executeDurableReview(input)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(input.route).toHaveBeenCalledTimes(1);
  });
  it("does not revive a cancellation during an in-flight effect", async () => {
    const input = options();
    const original = db.taskArtifact.upsert.getMockImplementation()!;
    db.taskArtifact.upsert.mockImplementationOnce(original).mockImplementationOnce(async (args: any) => { const result = await original(args); state.cancelAfterIntent = true; return result; });
    await expect(executeDurableReview(input)).rejects.toThrow("superseded");
    expect(state.run.status).toBe("canceled");
    expect(input.route).not.toHaveBeenCalled();
    expect([...state.artifacts.values()].some(row => row.name === "result")).toBe(false);
  });
  it("preserves partial state and reports unavailable nomination as failure", async () => {
    const input = options();
    input.route.mockImplementation(async () => ({ ...emptyRoutingSummary(), routed: [{ lineKey: "one", profileId: "test", domainClass: "test", actionKind: "no_change", proposalId: null, outcome: "reported:nomination unavailable" }] }));
    await expect(executeDurableReview(input)).rejects.toThrow("routing failed");
    expect(state.run.status).toBe("failed");
    expect([...state.artifacts.values()].map(row => row.name)).toEqual(expect.arrayContaining(["measurement", "intent:one"]));
  });
  it.each(["quiescing", "paused-for-upgrade", "paused-for-upgrade-forced"])("preserves %s for governed resume", async status => {
    const input = options();
    input.measure.mockRejectedValueOnce(new Error("read unavailable"));
    await expect(executeDurableReview(input)).rejects.toThrow();
    state.run.status = status;
    await expect(executeDurableReview(input)).resolves.toBe(false);
    expect(state.run.status).toBe(status);
    expect(input.route).not.toHaveBeenCalled();
  });

  it("rejects stale commission before creating a run", async () => {
    state.commissionValid = false;
    await expect(executeDurableReview(options())).rejects.toThrow("before admission");
    expect(state.run).toBeNull();
    expect(state.nodes.size).toBe(0);
  });
  it("retries a transaction-confirmed rollback using the frozen destination", async () => {
    const input = options();
    input.route.mockRejectedValueOnce(new Error("transaction callback failed"));
    await expect(executeDurableReview(input)).rejects.toThrow("callback failed");
    expect([...state.artifacts.values()].some(row => row.name.startsWith("rollback:"))).toBe(true);
    await expect(executeDurableReview(input)).resolves.toBe(true);
    expect(input.measure).toHaveBeenCalledTimes(1);
    expect(input.prepare).toHaveBeenCalledTimes(1);
    expect(input.route).toHaveBeenCalledTimes(2);
    expect([...state.artifacts.values()].filter(row => row.name === "intent:one")).toHaveLength(2);
  });

});
