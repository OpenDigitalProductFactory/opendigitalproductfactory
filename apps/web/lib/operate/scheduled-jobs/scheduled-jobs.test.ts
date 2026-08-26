// BI-5A42E572 / EP-PROACTIVE-OPS — Scheduled Jobs core + catalog tests.
//
// Focuses on catalog classification correctness. The mutation-policy guards
// (core-locked refusal, cadence validation, one-shot refusal) moved with the
// mutations themselves and are covered in ./control.test.ts.

import { describe, it, expect } from "vitest";

import {
  SCHEDULED_JOB_CATALOG,
  getCatalogEntry,
  isCatalogJobLocked,
} from "./catalog";
import { EDITABLE_SCHEDULE_OPTIONS } from "./control";

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

describe("editable cadence presets", () => {
  it("exposes the canonical presets including disabled", () => {
    expect(EDITABLE_SCHEDULE_OPTIONS).toContain("hourly");
    expect(EDITABLE_SCHEDULE_OPTIONS).toContain("disabled");
  });
});
