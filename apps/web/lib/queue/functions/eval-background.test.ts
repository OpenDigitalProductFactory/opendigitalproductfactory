import { beforeEach, describe, expect, it, vi } from "vitest";
import { currentInferenceOrigin } from "@/lib/inference/inference-admission";

const mocks = vi.hoisted(() => ({
  prisma: {
    endpointTestRun: { findUnique: vi.fn() },
    scheduledJob: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      upsert: vi.fn(),
    },
  },
  handlers: new Map<string, (input: any) => Promise<unknown>>(),
  eval: vi.fn(),
  owned: vi.fn(),
  probe: vi.fn(),
  gate: vi.fn(),
}));

vi.mock("@dpf/db", () => ({ prisma: mocks.prisma }));
// The Inngest client pulls in the whole queue graph at import; stub it.
vi.mock("@/lib/jobs", () => ({ jobs: { createFunction: (config: { id: string }, handler: any) => {
  mocks.handlers.set(config.id, handler);
  return {};
} } }));
vi.mock("../quiescence-gates", () => ({ gateAtEntry: mocks.gate }));
vi.mock("@/lib/routing/eval-runner", () => ({ runDimensionEval: mocks.eval }));
vi.mock("@/lib/routing/subscription-calibration-execution", () => ({ runSubscriptionCalibration: mocks.owned }));
vi.mock("@/lib/operate/endpoint-test-runner", () => ({ runEndpointTests: mocks.probe }));

import { claimEvalSlot } from "./eval-background";

const NOW = new Date("2026-07-14T12:00:00.000Z");

beforeEach(() => {
  vi.resetAllMocks();
  mocks.gate.mockResolvedValue({ proceed: true });
});

describe("claimEvalSlot (BI-C8164664)", () => {
  it("loses a first-run creation race instead of duplicating inference", async () => {
    mocks.prisma.scheduledJob.updateMany.mockResolvedValue({ count: 0 });
    mocks.prisma.scheduledJob.findUnique.mockResolvedValue(null);
    mocks.prisma.scheduledJob.create.mockRejectedValue({ code: "P2002" });
    await expect(claimEvalSlot("local/new-model", NOW)).resolves.toBe(false);
  });

  it("surfaces storage failure instead of claiming work without a reservation", async () => {
    mocks.prisma.scheduledJob.updateMany.mockResolvedValue({ count: 0 });
    mocks.prisma.scheduledJob.findUnique.mockResolvedValue(null);
    mocks.prisma.scheduledJob.create.mockRejectedValue(new Error("storage unavailable"));
    await expect(claimEvalSlot("local/new-model", NOW)).rejects.toThrow("storage unavailable");
  });
  it("wins the claim when the last eval attempt is older than the cooldown (or none)", async () => {
    mocks.prisma.scheduledJob.updateMany.mockResolvedValue({ count: 1 });

    await expect(claimEvalSlot("local/qwen", NOW)).resolves.toBe(true);

    const where = mocks.prisma.scheduledJob.updateMany.mock.calls[0]?.[0]?.where;
    expect(where?.jobId).toBe("eval-local/qwen");
    // Recency guard: claim only when lastRunAt is stale or unset.
    expect(where?.OR).toEqual([
      { lastRunAt: { lt: expect.any(Date) } },
      { lastRunAt: null },
    ]);
    expect(mocks.prisma.scheduledJob.create).not.toHaveBeenCalled();
  });

  it("LOSES the claim (skips GPU work) for a storm re-invocation within the cooldown", async () => {
    // updateMany matched 0 rows (a fresh lastRunAt exists) and the row is present.
    mocks.prisma.scheduledJob.updateMany.mockResolvedValue({ count: 0 });
    mocks.prisma.scheduledJob.findUnique.mockResolvedValue({ jobId: "eval-local/qwen" });

    await expect(claimEvalSlot("local/qwen", NOW)).resolves.toBe(false);
    expect(mocks.prisma.scheduledJob.create).not.toHaveBeenCalled();
  });

  it("creates and claims the slot on the first-ever eval for a model", async () => {
    mocks.prisma.scheduledJob.updateMany.mockResolvedValue({ count: 0 });
    mocks.prisma.scheduledJob.findUnique.mockResolvedValue(null);
    mocks.prisma.scheduledJob.create.mockResolvedValue({});

    await expect(claimEvalSlot("local/new-model", NOW)).resolves.toBe(true);
    expect(mocks.prisma.scheduledJob.create).toHaveBeenCalledOnce();
    expect(mocks.prisma.scheduledJob.create.mock.calls[0]?.[0]?.data).toMatchObject({
      jobId: "eval-local/new-model",
      lastStatus: "running",
      lastRunAt: NOW,
    });
  });
});

describe("background inference priority", () => {
  const step = { run: async (_name: string, fn: () => unknown) => fn() };

  it("sends a bound commission through its durable runner without the legacy force/reaper path", async () => {
    mocks.owned.mockResolvedValue({ testRunId: "DE-commission" });
    await mocks.handlers.get("ai/eval-background")!({ event: { data: { endpointId: "chatgpt", modelId: "selected", userId: "operator", force: true, calibrationRunId: "DE-commission" } }, step });
    expect(mocks.owned).toHaveBeenCalledExactlyOnceWith({ endpointId: "chatgpt", modelId: "selected", userId: "operator", runId: "DE-commission" });
    expect(mocks.eval).not.toHaveBeenCalled(); expect(mocks.prisma.scheduledJob.upsert).not.toHaveBeenCalled();
  });

  it.each(["incomplete", "completed", "failed"])("records the exact canonical %s result, rather than promise completion", async status => {
    mocks.eval.mockResolvedValue({ testRunId: "DE-result" });
    mocks.prisma.endpointTestRun.findUnique.mockResolvedValue({ endpointId: "ep", modelId: "selected", status });
    await mocks.handlers.get("ai/eval-background")!({ event: { data: { endpointId: "ep", modelId: "selected", userId: "operator", force: true } }, step });
    expect(mocks.prisma.scheduledJob.upsert.mock.calls[0][0]).toMatchObject({ create: { lastStatus: status }, update: { lastStatus: status } });
  });

  it.each([null, { endpointId: "foreign", modelId: "selected", status: "completed" }, { endpointId: "ep", modelId: "selected", status: "running" }])("does not project an absent, foreign or unfinished result %j", async actual => {
    mocks.eval.mockResolvedValue({ testRunId: "DE-result" }); mocks.prisma.endpointTestRun.findUnique.mockResolvedValue(actual);
    await mocks.handlers.get("ai/eval-background")!({ event: { data: { endpointId: "ep", modelId: "selected", userId: "operator", force: true } }, step });
    expect(mocks.prisma.scheduledJob.upsert).not.toHaveBeenCalled();
  });

  it("runs evaluations in the autonomous lane and restores the caller origin", async () => {
    mocks.eval.mockImplementation(async () => {
      await Promise.resolve();
      expect(currentInferenceOrigin()).toBe("autonomous");
      return { skipped: true };
    });
    await mocks.handlers.get("ai/eval-background")!({
      event: { data: { endpointId: "ep", modelId: "local/model", userId: "owner", force: true } }, step,
    });
    expect(mocks.eval).toHaveBeenCalledOnce();
    expect(currentInferenceOrigin()).toBe("interactive");
  });

  it("runs endpoint probes in the autonomous lane", async () => {
    mocks.probe.mockImplementation(async () => {
      await Promise.resolve();
      expect(currentInferenceOrigin()).toBe("autonomous");
      return [];
    });
    await mocks.handlers.get("ai/probe-background")!({ event: { data: { endpointId: "ep" } }, step });
    expect(mocks.probe).toHaveBeenCalledOnce();
    expect(currentInferenceOrigin()).toBe("interactive");
  });
});
