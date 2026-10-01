// Every change row of spec §4.2, classified (BI-CB5C0DCE, OBJ-DIFF: AC-DIFF-1).

import { describe, expect, it } from "vitest";

import { diffWorkShapeBinding, type BindingChangeKind } from "./work-shape-binding-diff";
import type { WorkShapeDefinitionContract, WorkShapeStage } from "./work-shapes";

const scan: WorkShapeStage = {
  key: "scan",
  title: "Scan",
  accountablePrincipalRef: "agent:watcher",
  advance: { kind: "status-change", condition: "scanned" },
  evidence: ["assurance-finding"],
  tools: ["read_a"],
};
const review: WorkShapeStage = {
  key: "review",
  title: "Review",
  accountablePrincipalRef: "person:owner",
  advance: { kind: "governed-decision", condition: "accepted", decisionScope: "wwmd" },
  evidence: ["decision-record"],
};

const v1: WorkShapeDefinitionContract = {
  key: "obligation-assurance-watch",
  version: "1.0.0",
  title: "Test shape",
  description: "A shape used in tests.",
  triggers: ["cadence"],
  stages: [scan, review],
  stopConditions: [
    { kind: "success", condition: "done", disposition: "proceed" },
    { kind: "failure", condition: "failed", disposition: "inconclusive" },
    { kind: "budget", condition: "exhausted", disposition: "awaiting-person" },
  ],
  grants: ["tool:read"],
  measures: [{ key: "findings-raised", description: "Findings raised" }],
  budgets: [{ kind: "findings-per-run", limit: 200, unit: "findings" }],
  reviewPoint: { everyDays: 7, description: "Weekly review" },
};

function next(patch: Partial<WorkShapeDefinitionContract>): WorkShapeDefinitionContract {
  return { ...v1, version: "1.1.0", ...patch };
}

const ROWS: Array<[string, WorkShapeDefinitionContract, BindingChangeKind, "widening" | "narrowing"]> = [
  ["tool added to a stage", next({ stages: [{ ...scan, tools: ["read_a", "read_b"] }, review] }), "tool-added", "widening"],
  ["stage added", next({ stages: [scan, { ...scan, key: "raise", title: "Raise" }, review] }), "stage-added", "widening"],
  ["accountable principal changed", next({ stages: [{ ...scan, accountablePrincipalRef: "agent:other" }, review] }), "accountable-changed", "widening"],
  ["governed decision becomes a status change", next({ stages: [scan, { ...review, advance: { kind: "status-change", condition: "accepted" } }] }), "advance-relaxed", "widening"],
  ["evidence kind added", next({ stages: [{ ...scan, evidence: ["assurance-finding", "decision-record"] }, review] }), "evidence-added", "widening"],
  ["grant added", next({ grants: ["tool:read", "tool:write"] }), "grant-added", "widening"],
  ["tool removed", next({ stages: [{ ...scan, tools: [] }, review] }), "tool-removed", "narrowing"],
  ["stage removed", next({ stages: [scan] }), "stage-removed", "narrowing"],
  ["status change becomes a governed decision", next({ stages: [{ ...scan, advance: { kind: "governed-decision", condition: "scanned", decisionScope: "wwmd" } }, review] }), "advance-tightened", "narrowing"],
  ["title or condition text only", next({ stages: [{ ...scan, title: "Scan the estate" }, review] }), "text-changed", "narrowing"],
  ["evidence kind removed", next({ stages: [scan, { ...review, evidence: [] }] }), "evidence-removed", "narrowing"],
  ["grant removed", next({ grants: [] }), "grant-removed", "narrowing"],
];

describe("diffWorkShapeBinding", () => {
  it.each(ROWS)("%s", (_label, to, kind, expected) => {
    const diff = diffWorkShapeBinding(v1, to);
    expect(diff.changes.map((row) => row.kind)).toContain(kind);
    expect(diff.classification).toBe(expected);
    expect(diff.fromVersion).toBe("1.0.0");
    expect(diff.toVersion).toBe("1.1.0");
  });

  it("an evidence kind replaced is a widening", () => {
    const diff = diffWorkShapeBinding(v1, next({ stages: [{ ...scan, evidence: ["decision-record"] }, review] }));
    expect(diff.classification).toBe("widening");
  });

  it("any widening row makes the whole diff a widening", () => {
    const diff = diffWorkShapeBinding(v1, next({ stages: [{ ...scan, tools: ["read_b"] }, review] }));
    expect(diff.changes.map((row) => row.class).sort()).toEqual(["narrowing", "widening"]);
    expect(diff.classification).toBe("widening");
  });

  it("an identical binding is unchanged", () => {
    expect(diffWorkShapeBinding(v1, next({})).classification).toBe("unchanged");
  });

  it("refuses to compare two different shapes", () => {
    expect(() => diffWorkShapeBinding(v1, { ...v1, key: "other" })).toThrow(/versions of one shape/);
  });
});
