// BI-5A42E572 / EP-PROACTIVE-OPS — Scheduled Jobs core + catalog tests.
//
// Focuses on the policy that must never regress: classification correctness
// and the core-locked refusal that protects platform-integrity crons from both
// operators and coworkers. These paths short-circuit before any DB/Inngest I/O,
// so no mocks are needed.

import { describe, it, expect } from "vitest";

import {
  SCHEDULED_JOB_CATALOG,
  getCatalogEntry,
  isCatalogJobLocked,
} from "./catalog";
import {
  updateJobSchedule,
  setJobEnabled,
  runJobNow,
  EDITABLE_SCHEDULE_OPTIONS,
} from "./core";

describe("scheduled-job catalog", () => {
  it("has unique jobIds and inngestIds", () => {
    const jobIds = SCHEDULED_JOB_CATALOG.map((e) => e.jobId);
    const inngestIds = SCHEDULED_JOB_CATALOG.map((e) => e.inngestId);
    expect(new Set(jobIds).size).toBe(jobIds.length);
    expect(new Set(inngestIds).size).toBe(inngestIds.length);
  });

  it("classifies the code-graph reconcile cron as core-locked with a run-now event", () => {
    const entry = getCatalogEntry("code-graph-reconcile");
    expect(entry).toBeDefined();
    expect(entry?.category).toBe("core");
    expect(entry?.runNowEvent).toBe("ops/code-graph.reconcile");
    expect(isCatalogJobLocked("code-graph-reconcile")).toBe(true);
  });

  it("marks every core job as locked and every editable job as unlocked", () => {
    for (const entry of SCHEDULED_JOB_CATALOG) {
      expect(isCatalogJobLocked(entry.jobId)).toBe(entry.category === "core");
    }
  });

  it("has at least one editable job (so cadence is tunable post-install)", () => {
    expect(SCHEDULED_JOB_CATALOG.some((e) => e.category === "editable")).toBe(true);
  });
});

describe("core-locked enforcement (shared by operator + coworker paths)", () => {
  it("refuses to edit a core-locked job's schedule", async () => {
    const res = await updateJobSchedule("code-graph-reconcile", "hourly", "test");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/core-locked/);
  });

  it("refuses to enable/disable a core-locked job", async () => {
    const res = await setJobEnabled("code-graph-reconcile", false, "test");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/core-locked/);
  });
});

describe("editable-job validation", () => {
  it("rejects an unknown schedule token before touching the DB", async () => {
    const res = await updateJobSchedule("issue-report-triage", "every-3000-years", "test");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Invalid schedule/);
  });

  it("exposes the canonical editable cadence options including disabled", () => {
    expect(EDITABLE_SCHEDULE_OPTIONS).toContain("hourly");
    expect(EDITABLE_SCHEDULE_OPTIONS).toContain("disabled");
  });
});

describe("run-now eligibility", () => {
  it("refuses run-now for a job with no manual-trigger event", async () => {
    const res = await runJobNow("infra-prune", "test");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/no manual-trigger event/);
  });
});
