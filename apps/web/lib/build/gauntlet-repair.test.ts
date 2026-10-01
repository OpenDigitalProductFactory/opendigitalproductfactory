// BI-FBA2FDBE slice 2 — a build whose guards fail on its own change is handed
// back to its coding agent with the findings, a bounded number of times, then
// escalated to the operator. Never an endless re-review of the same tree.
import { describe, expect, it } from "vitest";

import { buildGauntletRepairTask, buildReviewRepairTask, decideGauntletRepair, GAUNTLET_REPAIR_MAX_ATTEMPTS, repairTaskFor } from "./gauntlet-repair";

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

// BI-50E8802C — a semantic review that asks for repair goes back to the coding
// agent through the same hand-back (live 2026-10-01: FB-328CF75B passed every
// guard, then sat in review with 4 blocking findings nothing consumed).
describe("review-finding repair", () => {
  const findings = [
    { severity: "critical", description: "db client is undefined when the adapter writes telemetry", location: "apps/web/lib/routing/adapter-telemetry-writer.ts:42", suggestion: "inject the client" },
    { severity: "important", description: "no test covers the failure path" },
  ];

  it("briefs every blocking finding with its location and suggestion", () => {
    const task = buildReviewRepairTask({ findings });
    expect(task.implement).toContain("db client is undefined");
    expect(task.implement).toContain("adapter-telemetry-writer.ts:42");
    expect(task.implement).toContain("inject the client");
    expect(task.implement).toContain("no test covers the failure path");
  });

  it("forbids weakening tests, guards or the review to make it pass", () => {
    expect(buildReviewRepairTask({ findings }).implement).toMatch(/never (weaken|skip|delete)/i);
  });

  it("picks the brief by the hand-back's source", () => {
    const review = repairTaskFor({ source: "review", findings, failedGuards: ["Semantic change review"], treeSha: "t", recordId: null, attempts: 1 }, "");
    expect(review.implement).toContain("db client is undefined");
    const guards = repairTaskFor({ source: "guards", failedGuards: ["Data-Impact Gate"], treeSha: "t", recordId: "r", attempts: 1 }, "[data-impact] FAILED");
    expect(guards.implement).toContain("Data-Impact Gate");
  });

  it("briefs an unmitigated risk as something to mitigate in code, never to relabel", () => {
    const risk = repairTaskFor({ source: "risk", findings: [{ severity: "high", description: "telemetry-write: adapter writes with an undefined client → inference fails" }], failedGuards: ["Failure analysis"], treeSha: "t", recordId: null, attempts: 1 }, "");
    expect(risk.title).toMatch(/Mitigate/);
    expect(risk.implement).toContain("undefined client");
    expect(risk.implement).toMatch(/never describe a risk as mitigated without the code/i);
  });

  it("shares one attempt bound with guard hand-backs", () => {
    const afterGuards = { source: "guards" as const, failedGuards: ["x"], treeSha: "t", recordId: "r", attempts: GAUNTLET_REPAIR_MAX_ATTEMPTS };
    expect(decideGauntletRepair(afterGuards, { treeSha: "t2", recordId: null, failedGuards: ["Semantic change review"], source: "review", findings }).action).toBe("escalate");
  });
});
