import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@dpf/db", () => ({
  executeBootstrapDiscovery: vi.fn().mockResolvedValue({}),
  prisma: {
    scheduledJob: {
      upsert: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock("../inference/model-discovery-scheduler", () => ({
  registerModelDiscoveryJob: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../integrate/code-graph-refresh", () => ({
  registerCodeGraphScheduledJob: vi.fn().mockResolvedValue(undefined),
}));

// Must import after mock setup
import { runPrometheusTargetCheck, runFullDiscoverySweep, registerScheduledJobs } from "./discovery-scheduler";
import { registerModelDiscoveryJob } from "../inference/model-discovery-scheduler";
import { registerCodeGraphScheduledJob } from "../integrate/code-graph-refresh";

describe("registerScheduledJobs", () => {
  it("upserts both ScheduledJob rows", async () => {
    const { prisma } = await import("@dpf/db");
    const upsert = prisma.scheduledJob.upsert as ReturnType<typeof vi.fn>;
    upsert.mockClear();

    await registerScheduledJobs();
    expect(upsert).toHaveBeenCalledTimes(3);
    expect(registerModelDiscoveryJob).toHaveBeenCalledTimes(1);
    expect(registerCodeGraphScheduledJob).toHaveBeenCalledTimes(1);
  });
});

describe("runPrometheusTargetCheck", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty when prometheus is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const result = await runPrometheusTargetCheck();
    expect(result.newTargets).toEqual([]);
  });

  it("returns target keys when prometheus responds", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          activeTargets: [
            { labels: { job: "postgres", instance: "postgres:5432" }, health: "up" },
          ],
        },
      }),
    }));

    const result = await runPrometheusTargetCheck();
    expect(result.newTargets).toContain("postgres:postgres:5432");
  });
});

describe("runFullDiscoverySweep", () => {
  it("calls executeBootstrapDiscovery", async () => {
    const { executeBootstrapDiscovery } = await import("@dpf/db");
    const mockExec = executeBootstrapDiscovery as ReturnType<typeof vi.fn>;
    mockExec.mockClear();

    await runFullDiscoverySweep();
    expect(mockExec).toHaveBeenCalledTimes(1);
  });
});
