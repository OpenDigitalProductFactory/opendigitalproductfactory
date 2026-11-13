import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  run: vi.fn(), gate: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), config: null as unknown,
  rank: vi.fn(), answer: vi.fn(),
}));
vi.mock("@/lib/ecosystem/arbitration-cycle", () => ({
  runEcosystemArbitrationCycle: mocks.rank,
  sendEcosystemDecisionNotices: mocks.answer,
  summarizeArbitration: () => "Ecosystem queue: 2 ranked.",
}));
vi.mock("@/lib/federation/demand-disposition", () => ({ queueFounderDispositionNotices: vi.fn() }));
vi.mock("@/lib/federation/demand-exchange", () => ({ decodeDemandMirrorPayload: vi.fn() }));
vi.mock("@/lib/jobs", () => ({ jobs: { createFunction: (config: unknown, handler: unknown) => { mocks.config = config; return handler; } } }));
vi.mock("../quiescence-gates", () => ({ gateAtEntry: mocks.gate }));
vi.mock("@/lib/ecosystem/inbound-triage-runner", () => ({ runEcosystemInboundTriage: mocks.run }));
vi.mock("@dpf/db", () => ({ prisma: { scheduledJob: { findUnique: mocks.findUnique, upsert: mocks.upsert } } }));

import { ecosystemInboundTriage } from "./ecosystem-inbound-triage";
import { deriveHealth } from "@/lib/operate/scheduled-jobs/work-model";

const invoke = () => (ecosystemInboundTriage as unknown as (context: unknown) => Promise<unknown>)({
  step: { run: (_name: string, fn: () => Promise<unknown>) => fn() },
});

describe("ecosystem intake job reporting", () => {
  it("advances the issue cursor from scan start without losing the commission metadata", async () => {
    mocks.run.mockResolvedValue({ ran: true, complete: false, issueReadComplete: true, scannedAt: "2026-11-02T12:00:00Z",
      ingested: 0, deduped: 0, failed: 0, itemIds: [], sourceErrors: [{ source: "dependabot", error: "HTTP 403" }] });
    await invoke();
    expect(mocks.upsert.mock.calls[0][0].update).toMatchObject({ runCursor: "2026-11-02T12:00:00Z", lastStatus: "failed" });
    expect(mocks.upsert.mock.calls[0][0].update).not.toHaveProperty("metadata");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.gate.mockResolvedValue({ proceed: true });
    mocks.findUnique.mockResolvedValue({ schedule: "17 6 * * 1" });
    mocks.upsert.mockResolvedValue({});
    mocks.rank.mockResolvedValue({ ranked: 2, recorded: 0, top: [] });
    mocks.answer.mockResolvedValue({ sent: 0, withheld: [] });
  });

  it("never overwrites scheduled-job metadata, so a commission reference survives every heartbeat", async () => {
    mocks.run.mockResolvedValue({ ran: true, complete: true, ingested: 0, deduped: 0, failed: 0, itemIds: [], sourceErrors: [] });
    await invoke();
    const args = mocks.upsert.mock.calls[0][0];
    expect(args.update).not.toHaveProperty("metadata");
    expect(args.create).not.toHaveProperty("metadata");
  });

  it("persists incomplete coverage for the existing schedule view without replaying ingestion", async () => {
    const result = { ran: true, complete: false, ingested: 1, deduped: 0, failed: 0,
      itemIds: ["BI-PEER"], sourceErrors: [{ source: "upstream-issue", error: "GitHub unavailable" }] };
    mocks.run.mockResolvedValue(result);
    await expect(invoke()).resolves.toEqual(result);
    expect(mocks.run).toHaveBeenCalledOnce();
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { jobId: "ecosystem-inbound-issue-triage" },
      update: expect.objectContaining({ lastStatus: "failed", lastError: expect.stringContaining("GitHub unavailable"),
        lastRunSummary: expect.stringContaining("1 created"), nextRunAt: expect.any(Date) }),
    }));
    const heartbeat = mocks.upsert.mock.calls[0][0].update;
    expect(deriveHealth({ kind: "recurring", enabled: true, schedule: "17 6 * * 1",
      reportsRunData: true, ...heartbeat }, new Date()).health).toBe("error");
  });

  it("refreshes a stale stored schedule to the code trigger's cadence (BI-78C6646C)", async () => {
    mocks.run.mockResolvedValue({ ran: false, reason: "not commissioned: test" });
    const before = Date.now();
    await invoke();
    const { update, create } = mocks.upsert.mock.calls[0][0];
    expect(update.schedule).toBe("17 */4 * * *");
    expect(create.schedule).toBe("17 */4 * * *");
    // Projected from the four-hourly trigger, not the old weekly value.
    expect(update.nextRunAt.getTime() - before).toBeLessThanOrEqual(4 * 60 * 60 * 1000);
  });

  it("clears an old error after a complete scan", async () => {
    mocks.run.mockResolvedValue({ ran: true, complete: true, ingested: 0, deduped: 3, failed: 0, itemIds: [], sourceErrors: [] });
    await invoke();
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ lastStatus: "completed", lastError: null }),
    }));
  });

  it("retries heartbeat persistence using the durable scan result", async () => {
    mocks.run.mockResolvedValue({ ran: true, complete: true, ingested: 1, deduped: 0, failed: 0, itemIds: ["BI-NEW"], sourceErrors: [] });
    mocks.upsert.mockRejectedValueOnce(new Error("database unavailable")).mockResolvedValue({});
    const completed = new Map<string, unknown>();
    const context = { step: { run: async (name: string, fn: () => Promise<unknown>) => {
      if (completed.has(name)) return completed.get(name);
      const value = await fn();
      completed.set(name, value);
      return value;
    } } };
    const handler = ecosystemInboundTriage as unknown as (context: unknown) => Promise<unknown>;
    await expect(handler(context)).rejects.toThrow("database unavailable");
    await expect(handler(context)).resolves.toMatchObject({ ingested: 1 });
    expect(mocks.run).toHaveBeenCalledOnce();
    expect(mocks.upsert).toHaveBeenCalledTimes(2);
  });

  it("reports created, unchanged, changed and needs-review counts in the run summary (BI-952F08BA)", async () => {
    mocks.run.mockResolvedValue({ ran: true, complete: true, ingested: 1, deduped: 3, unchanged: 2, changed: 1, needsReview: 1,
      failed: 0, itemIds: ["BI-NEW"], reviews: [{ origin: "ecosystem-upstream-issue:a/b#1", candidates: ["BI-A", "BI-B"] }], sourceErrors: [] });
    await invoke();
    const summary = mocks.upsert.mock.calls[0][0].update.lastRunSummary as string;
    expect(summary).toContain("1 created");
    expect(summary).toContain("2 unchanged");
    expect(summary).toContain("1 changed");
    expect(summary).toContain("1 needs review");
    expect(summary).toContain("a/b#1");
  });

  it("ranks the ecosystem queue and answers submitters after a commissioned scan (BI-FB03E2FD)", async () => {
    mocks.run.mockResolvedValue({ ran: true, complete: true, ingested: 0, deduped: 0, failed: 0, itemIds: [], sourceErrors: [] });
    await invoke();
    expect(mocks.rank).toHaveBeenCalledTimes(1);
    expect(mocks.answer).toHaveBeenCalledTimes(1);
    expect(mocks.upsert.mock.calls[0][0].update.lastRunSummary).toContain("Ecosystem queue: 2 ranked.");
  });

  it("keeps the scan heartbeat when ranking fails, and says so", async () => {
    mocks.run.mockResolvedValue({ ran: true, complete: true, ingested: 0, deduped: 0, failed: 0, itemIds: [], sourceErrors: [] });
    mocks.rank.mockRejectedValue(new Error("database unavailable"));
    await invoke();
    const update = mocks.upsert.mock.calls[0][0].update;
    expect(update.lastStatus).toBe("completed");
    expect(update.lastRunSummary).toContain("Ecosystem queue not ranked: database unavailable");
  });

  it("allows only one scan of the inbound queue at a time", () => {
    // Local single-run protection (spec §6.1): an overlapping cron and retry must
    // not ingest the same sources concurrently.
    expect(mocks.config).toMatchObject({ concurrency: { limit: 1, scope: "account", key: "'ecosystem-inbound-intake'" } });
  });

  it("does not report an uncommissioned installation as a successful scan", async () => {
    mocks.run.mockResolvedValue({ ran: false, reason: "not commissioned: installation is not a production install" });
    await invoke();
    expect(mocks.rank).not.toHaveBeenCalled();
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ lastStatus: "not-configured", lastRunSummary: "not commissioned: installation is not a production install" }),
    }));
    const heartbeat = mocks.upsert.mock.calls[0][0].update;
    expect(deriveHealth({ kind: "recurring", enabled: true, schedule: "17 6 * * 1",
      reportsRunData: true, ...heartbeat }, new Date()).health).toBe("untracked");
  });

  it("honors the entry gate without ingestion or heartbeat writes", async () => {
    mocks.gate.mockResolvedValue({ proceed: false, reason: "disabled" });
    await expect(invoke()).resolves.toEqual({ skipped: true, reason: "disabled" });
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
