// BI-FBA2FDBE slice 2 — a build whose guards fail on its own change is handed
// back to its coding agent with the findings, a bounded number of times, then
// escalated to the operator. Never an endless re-review of the same tree.
import { describe, expect, it } from "vitest";

import { buildGauntletRepairTask, decideGauntletRepair, GAUNTLET_REPAIR_MAX_ATTEMPTS } from "./gauntlet-repair";

const failure = { treeSha: "t1", recordId: "rec-1", failedGuards: ["Data-Impact Gate", "Derived Artifact Registry"] };

describe("decideGauntletRepair", () => {
  it("hands the first failure back for repair", () => {
    const d = decideGauntletRepair(undefined, failure);
    expect(d.action).toBe("repair");
    expect(d.next).toMatchObject({ attempts: 1, treeSha: "t1", recordId: "rec-1", failedGuards: failure.failedGuards });
  });

  it("repairs again while under the bound, even when the last repair left the tree unchanged", () => {
    const d = decideGauntletRepair({ ...failure, attempts: 1 }, failure);
    expect(d.action).toBe("repair");
    expect(d.next.attempts).toBe(2);
  });

  it("escalates once the bound is spent", () => {
    const d = decideGauntletRepair({ ...failure, attempts: GAUNTLET_REPAIR_MAX_ATTEMPTS }, failure);
    expect(d.action).toBe("escalate");
  });

  it("does nothing further once escalated", () => {
    const d = decideGauntletRepair({ ...failure, attempts: GAUNTLET_REPAIR_MAX_ATTEMPTS, escalated: true }, failure);
    expect(d.action).toBe("none");
  });
});

describe("buildGauntletRepairTask", () => {
  it("names every failing guard and carries the guard output", () => {
    const task = buildGauntletRepairTask({ failedGuards: failure.failedGuards, output: "[data-impact] FAILED — schema change without a data-impact manifest" });
    expect(task.implement).toContain("Data-Impact Gate");
    expect(task.implement).toContain("Derived Artifact Registry");
    expect(task.implement).toContain("schema change without a data-impact manifest");
  });

  it("forbids weakening, skipping or editing the guards", () => {
    const task = buildGauntletRepairTask({ failedGuards: ["Repo Guard Loop"], output: "x" });
    expect(task.implement).toMatch(/never (weaken|skip|edit)/i);
  });

  it("clips very long guard output to its tail, where the failure summary is", () => {
    const output = `${"noise\n".repeat(20_000)}FINAL SUMMARY: Derived Artifact Registry STALE`;
    const task = buildGauntletRepairTask({ failedGuards: ["Derived Artifact Registry"], output });
    expect(task.implement.length).toBeLessThan(12_000);
    expect(task.implement).toContain("FINAL SUMMARY: Derived Artifact Registry STALE");
  });
});
