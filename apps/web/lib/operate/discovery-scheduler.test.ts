import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

vi.mock("@/lib/hive/contribute-fingerprint", () => ({
  contributeEligibleFingerprintRules: vi.fn().mockResolvedValue({ eligible: 0, contributed: 0, skipped: 0 }),
}));

// Must import after mock setup
import { runPrometheusTargetCheck, runFullDiscoverySweep, registerScheduledJobs, recordJobRun } from "./discovery-scheduler";
import { registerModelDiscoveryJob } from "../inference/model-discovery-scheduler";
import { registerCodeGraphScheduledJob } from "../integrate/code-graph-refresh";

describe("registerScheduledJobs", () => {
  it("upserts every managed ScheduledJob row", async () => {
    const { prisma } = await import("@dpf/db");
    const upsert = prisma.scheduledJob.upsert as ReturnType<typeof vi.fn>;
    upsert.mockClear();

    await registerScheduledJobs();
    expect(upsert).toHaveBeenCalledTimes(4);
    expect(registerModelDiscoveryJob).toHaveBeenCalledTimes(1);
    expect(registerCodeGraphScheduledJob).toHaveBeenCalledTimes(1);
  });

  // Regression: backlog-triage-drain called recordJobRun() for a jobId that was
  // never registered, so the row was missing and recordJobRun's update() threw
  // P2025 ~once an hour. Registration must cover every recordJobRun() caller.
  it("registers the backlog-triage-drain job that recordJobRun() writes back to", async () => {
    const { prisma } = await import("@dpf/db");
    const upsert = prisma.scheduledJob.upsert as ReturnType<typeof vi.fn>;
    upsert.mockClear();

    await registerScheduledJobs();
    const registeredJobIds = upsert.mock.calls.map((c) => c[0].where.jobId);
    expect(registeredJobIds).toContain("backlog-triage-drain");
  });
});

describe("recordJobRun", () => {
  it("upserts (self-heals) so a missing ScheduledJob row never throws P2025", async () => {
    const { prisma } = await import("@dpf/db");
    const upsert = prisma.scheduledJob.upsert as ReturnType<typeof vi.fn>;
    const update = prisma.scheduledJob.update as ReturnType<typeof vi.fn>;
    upsert.mockClear();
    update.mockClear();

    await recordJobRun("backlog-triage-drain", "ok");

    // Must upsert, never bare update() — update() is what threw P2025.
    expect(update).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledTimes(1);
    const call = upsert.mock.calls[0][0];
    expect(call.where).toEqual({ jobId: "backlog-triage-drain" });
    // create branch carries name + schedule so the row can materialize.
    expect(call.create).toMatchObject({
      jobId: "backlog-triage-drain",
      name: expect.any(String),
      schedule: expect.any(String),
      lastStatus: "ok",
    });
    expect(call.update).toMatchObject({ lastStatus: "ok" });
  });
});

describe("runPrometheusTargetCheck", () => {
  const savedPrometheusUrl = process.env.PROMETHEUS_URL;

  beforeEach(() => {
    vi.restoreAllMocks();
    // The configured-path tests below need an explicit target; the short-circuit
    // test clears it. Default each test to "configured".
    process.env.PROMETHEUS_URL = "http://prometheus.example:9090";
  });

  afterEach(() => {
    if (savedPrometheusUrl === undefined) delete process.env.PROMETHEUS_URL;
    else process.env.PROMETHEUS_URL = savedPrometheusUrl;
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

  // BI-63FF58D2: with no PROMETHEUS_URL configured (fresh/local topology) the
  // poll must NOT fetch the unresolved in-cluster default and record an hourly
  // "error"/"fetch failed" — it records a neutral "not-configured" and skips.
  it("skips the fetch and records not-configured when no target is set", async () => {
    delete process.env.PROMETHEUS_URL;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { prisma } = await import("@dpf/db");
    const upsert = prisma.scheduledJob.upsert as ReturnType<typeof vi.fn>;
    upsert.mockClear();

    const result = await runPrometheusTargetCheck();

    expect(result.newTargets).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0].update.lastStatus).toBe("not-configured");
  });
});

describe("runFullDiscoverySweep", () => {
  it("runs discovery then submits eligible local fingerprint rules to the governed hive ledger", async () => {
    const { executeBootstrapDiscovery } = await import("@dpf/db");
    const mockExec = executeBootstrapDiscovery as ReturnType<typeof vi.fn>;
    mockExec.mockClear();

    await runFullDiscoverySweep();
    expect(mockExec).toHaveBeenCalledTimes(1);
    const { contributeEligibleFingerprintRules } = await import("@/lib/hive/contribute-fingerprint");
    expect(contributeEligibleFingerprintRules).toHaveBeenCalledTimes(1);
  });
});
