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

// Typed gate and binding rows (GPP shape compiler, BI-6DA17863 PR-3b-4; spec
// docs/superpowers/specs/2026-10-02-gpp-shape-notation-and-compiler-design.md
// §4.4). A row fires only when both versions carry the field; absent ->
// present is making-explicit and stays `unchanged`.
describe("diffWorkShapeBinding: typed gates and bindings", () => {
  const gate = {
    authority: "wwmd",
    mode: "enforced",
    blocking: true,
    resolution: "accountable-human",
  } as const;
  const binding = { id: "review-binding", version: 1, enforcement: "shadow" } as const;
  const gated = (patch: Partial<typeof gate> | Record<string, unknown> = {}): WorkShapeStage => ({
    ...review,
    advance: { kind: "governed-decision", condition: "accepted", decisionScope: "wwmd", gate: { ...gate, ...patch } as never },
  });
  const bound = (patch: Record<string, unknown> = {}): WorkShapeStage => ({ ...gated(), binding: { ...binding, ...patch } as never });
  const withStages = (stages: WorkShapeStage[], version = "1.0.0"): WorkShapeDefinitionContract => ({ ...v1, version, stages });

  const GATE_ROWS: Array<[string, WorkShapeStage, WorkShapeStage, BindingChangeKind, "widening" | "narrowing"]> = [
    ["gate mode enforced -> shadow", gated(), gated({ mode: "shadow" }), "gate-mode-relaxed", "widening"],
    ["gate blocking -> non-blocking", gated(), gated({ blocking: false }), "gate-blocking-relaxed", "widening"],
    ["gate authority changed", gated(), gated({ authority: "wwwd" }), "gate-authority-changed", "widening"],
    ["binding enforcement raised", bound(), bound({ enforcement: "enforced" }), "binding-enforcement-raised", "narrowing"],
    ["binding enforcement raised to an environment boundary", bound({ enforcement: "enforced" }), bound({ enforcement: "environment", egress: [] }), "binding-enforcement-raised", "narrowing"],
    ["binding enforcement lowered", bound({ enforcement: "enforced" }), bound(), "binding-enforcement-lowered", "widening"],
    ["binding version changed", bound(), bound({ version: 2 }), "binding-version-changed", "widening"],
  ];

  it.each(GATE_ROWS)("%s", (_label, fromStage, toStage, kind, expected) => {
    const diff = diffWorkShapeBinding(withStages([scan, fromStage]), withStages([scan, toStage], "1.1.0"));
    expect(diff.changes).toEqual([expect.objectContaining({ kind, class: expected, stageKey: "review" })]);
    expect(diff.classification).toBe(expected);
  });

  it("adding a gate equal to today's behaviour to a governed stage classifies unchanged", () => {
    const diff = diffWorkShapeBinding(v1, withStages([scan, gated()], "1.0.0"));
    expect(diff.changes).toEqual([]);
    expect(diff.classification).toBe("unchanged");
  });

  it("adding a binding to a stage classifies unchanged", () => {
    const diff = diffWorkShapeBinding(withStages([scan, gated()]), withStages([scan, bound()]));
    expect(diff.changes).toEqual([]);
    expect(diff.classification).toBe("unchanged");
  });

  it("a gate or binding present on only one side is not a row in either direction", () => {
    expect(diffWorkShapeBinding(withStages([scan, bound()]), v1).changes).toEqual([]);
    expect(diffWorkShapeBinding(v1, withStages([scan, bound({ enforcement: "environment", egress: ["read_a"] })])).changes).toEqual([]);
  });

  it("an identical gate and binding are unchanged, and unrelated gate fields are not rows", () => {
    const tighter = bound();
    const diff = diffWorkShapeBinding(
      withStages([scan, tighter]),
      withStages([scan, { ...tighter, advance: { ...gated({ mode: "enforced", gateKey: "explicit-key", escalation: { role: "role:owner", whileWaiting: "hold" } }).advance } }]),
    );
    expect(diff.classification).toBe("unchanged");
  });

  it("tightening a gate (shadow -> enforced, non-blocking -> blocking) is not a widening", () => {
    const diff = diffWorkShapeBinding(withStages([scan, gated({ mode: "shadow", blocking: false })]), withStages([scan, gated()]));
    expect(diff.changes.filter((row) => row.class === "widening")).toEqual([]);
  });
});
