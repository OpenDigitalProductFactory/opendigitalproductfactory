import { describe, expect, it, vi } from "vitest";

import { describeCoverage, recordCoverageRun } from "./embedding-coverage-workroom";
import { CORPUS_HEALTH_WORKROOM_ID, EMBEDDING_COVERAGE_ACTIVITY_KIND } from "./embedding-coverage-constants";

// BI-ED117C82 — a self-heal nobody can observe is indistinguishable from one
// that never runs, which is exactly how the previous version failed: no caller
// at all for months, and no surface would have shown the difference.
describe("embedding coverage is reported in operator language (BI-ED117C82)", () => {
  const base = { scanned: 10, missing: 0, embedded: 0, failed: [] as string[] };

  it("states coverage as a fraction of what coworkers can search", () => {
    const r = describeCoverage({ ...base });
    expect(r.covered).toBe(10);
    expect(r.summary).toContain("10 of 10 reference pages are searchable by your coworkers");
  });

  it("says a provider outage retries itself, and names the consequence", () => {
    const r = describeCoverage({ scanned: 10, missing: 3, embedded: 0, failed: ["a", "b", "c"], providerUnavailable: true });
    expect(r.providerUnavailable).toBe(true);
    expect(r.summary).toContain("retries automatically");
    // The operator cannot connect "embeddings" to what they actually see, so the
    // text has to make that link for them.
    expect(r.summary).toContain("already decided");
    // Never instruct a restart, a script, or a button.
    expect(r.summary).not.toMatch(/restart|script|button|admin/i);
  });

  it("reports a partial repair without claiming success", () => {
    const r = describeCoverage({ scanned: 10, missing: 4, embedded: 2, failed: ["x", "y"] });
    expect(r.repaired).toBe(2);
    expect(r.summary).toContain("Repaired 2");
    expect(r.summary).toContain("retried");
  });

  it("distinguishes 'nothing needed repair' from 'repaired some'", () => {
    expect(describeCoverage({ ...base }).summary).toContain("Nothing needed repair");
    expect(describeCoverage({ ...base, embedded: 3 }).summary).toContain("repaired 3");
  });
});

describe("coverage runs land in the corpus-health Workroom (BI-ED117C82)", () => {
  function db() {
    return {
      workroom: { upsert: vi.fn(async (_args: unknown) => ({ id: "room-1" })) },
      workroomActivity: { create: vi.fn(async (_args: unknown) => ({})) },
    };
  }

  it("upserts the durable Workroom and records one activity", async () => {
    const client = db();
    await recordCoverageRun({ db: client, result: { scanned: 5, missing: 1, embedded: 1, failed: [] } });

    expect(client.workroom.upsert).toHaveBeenCalledTimes(1);
    const upsert = client.workroom.upsert.mock.calls[0]![0] as unknown as { where: { capsuleId: string } };
    expect(upsert.where.capsuleId).toBe(CORPUS_HEALTH_WORKROOM_ID);

    const activity = client.workroomActivity.create.mock.calls[0]![0] as unknown as {
      data: { workCapsuleId: string; kind: string; payload: Record<string, unknown> };
    };
    expect(activity.data.workCapsuleId).toBe("room-1");
    expect(activity.data.kind).toBe(EMBEDDING_COVERAGE_ACTIVITY_KIND);
    expect(activity.data.payload).toMatchObject({ covered: 5, scanned: 5, repaired: 1 });
  });

  it("carries the outage flag so a run is not mistaken for a clean pass", async () => {
    const client = db();
    await recordCoverageRun({
      db: client,
      result: { scanned: 5, missing: 5, embedded: 0, failed: ["a"], providerUnavailable: true },
    });
    const activity = client.workroomActivity.create.mock.calls[0]![0] as unknown as { data: { payload: { providerUnavailable: boolean } } };
    expect(activity.data.payload.providerUnavailable).toBe(true);
  });

  // Visibility must never be able to break the repair it reports on.
  it("never throws when the Workroom write fails", async () => {
    const client = db();
    client.workroom.upsert = vi.fn(async (_args: unknown) => { throw new Error("db down"); });
    const logger = { warn: vi.fn() };
    const report = await recordCoverageRun({ db: client, result: { scanned: 5, missing: 0, embedded: 0, failed: [] }, logger });
    expect(report.covered).toBe(5);
    expect(logger.warn).toHaveBeenCalled();
  });
});
