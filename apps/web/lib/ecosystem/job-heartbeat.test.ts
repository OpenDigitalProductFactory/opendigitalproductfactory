import { describe, expect, it, vi } from "vitest";

import {
  AWAITING_CONSENT_PREFIX,
  SUBMISSION_SWEEP_JOB_ID,
  WEEKLY_DIGEST_JOB_ID,
  digestHeartbeat,
  recordEcosystemJobHeartbeat,
  sweepHeartbeat,
} from "./job-heartbeat";

const base = { submitted: 0, skipped: 0, failed: 0, halted: null as string | null };

describe("sweepHeartbeat", () => {
  it("names how many problems are waiting when halted for want of consent", () => {
    const beat = sweepHeartbeat({ ...base, halted: "awaiting-consent", waiting: 3 });
    expect(beat.lastStatus).toBe("not-configured");
    expect(beat.lastRunSummary.startsWith(AWAITING_CONSENT_PREFIX)).toBe(true);
    expect(beat.lastRunSummary).toContain("3 problems triaged here are not reaching the ecosystem");
  });

  it("still asks when nothing is waiting yet, because the next problem will not reach anyone either", () => {
    expect(sweepHeartbeat({ ...base, halted: "awaiting-consent", waiting: 0 }).lastRunSummary)
      .toContain("new problems triaged here will be not reaching");
  });

  it("records a deliberate operator choice without the prefix, so it never nags", () => {
    for (const halted of ["paused", "fork-only", "not-applicable"]) {
      const beat = sweepHeartbeat({ ...base, halted });
      expect(beat.lastStatus).toBe("not-configured");
      expect(beat.lastRunSummary.startsWith(AWAITING_CONSENT_PREFIX)).toBe(false);
    }
  });

  it("distinguishes some-failed from all-failed", () => {
    expect(sweepHeartbeat({ ...base, submitted: 2, failed: 1 }).lastStatus).toBe("partial");
    expect(sweepHeartbeat({ ...base, submitted: 0, failed: 2 }).lastStatus).toBe("failed");
  });

  it("reports a clean run as completed with its counts", () => {
    expect(sweepHeartbeat({ ...base, submitted: 4, skipped: 1 })).toEqual({
      lastStatus: "completed",
      lastRunSummary: "4 submitted, 1 skipped, 0 failed.",
      lastError: null,
    });
  });
});

describe("digestHeartbeat", () => {
  it("reports a quiet week as completed, not as a failure", () => {
    expect(digestHeartbeat({ delivered: false, reason: "quiet-week", message: "x" }).lastStatus).toBe("completed");
  });

  it("reports a lost digest as failed, never as delivered", () => {
    const beat = digestHeartbeat({ delivered: false, reason: "delivery-failed", message: "room archived" });
    expect(beat.lastStatus).toBe("failed");
    expect(beat.lastError).toBe("room archived");
  });

  it("records a missing ecosystem voice as not configured with its reason", () => {
    expect(digestHeartbeat({ delivered: false, reason: "no-room", message: "no federation identity" }))
      .toMatchObject({ lastStatus: "not-configured", lastRunSummary: "no federation identity" });
  });
});

describe("recordEcosystemJobHeartbeat", () => {
  it("writes the register row with the catalogued schedule refreshed on every run", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const now = new Date("2026-11-16T05:41:00Z");
    await recordEcosystemJobHeartbeat(
      SUBMISSION_SWEEP_JOB_ID,
      { lastStatus: "completed", lastRunSummary: "ok", lastError: null },
      { db: { scheduledJob: { upsert } }, now },
    );
    const args = upsert.mock.calls[0][0];
    expect(args.where).toEqual({ jobId: SUBMISSION_SWEEP_JOB_ID });
    expect(args.update).toMatchObject({ schedule: "41 5 * * *", lastRunAt: now, lastStatus: "completed" });
    expect(args.update.nextRunAt).toBeInstanceOf(Date);
    expect(args.create.name).toBeTruthy();
  });

  it("covers the weekly digest's catalogued schedule too", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    await recordEcosystemJobHeartbeat(
      WEEKLY_DIGEST_JOB_ID,
      { lastStatus: "completed", lastRunSummary: "ok", lastError: null },
      { db: { scheduledJob: { upsert } } },
    );
    expect(upsert.mock.calls[0][0].update.schedule).toBe("5 6 * * 1");
  });

  it("refuses an id that is not a catalogued ecosystem cron rather than inventing a schedule", async () => {
    await expect(recordEcosystemJobHeartbeat(
      "not-a-job",
      { lastStatus: "completed", lastRunSummary: "ok", lastError: null },
      { db: { scheduledJob: { upsert: vi.fn() } } },
    )).rejects.toThrow(/not a catalogued/);
  });
});
