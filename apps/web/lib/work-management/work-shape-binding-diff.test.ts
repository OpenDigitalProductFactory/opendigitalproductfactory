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
// §4.4). Absent -> present is making-explicit and stays `unchanged`;
// present -> absent withdraws a control and is a widening row.
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

  it("adding a gate and binding together, even an environment boundary, is not a row", () => {
    expect(diffWorkShapeBinding(v1, withStages([scan, bound({ enforcement: "environment", egress: ["read_a"] })])).changes).toEqual([]);
  });

  it("removing a gate is a widening row", () => {
    const diff = diffWorkShapeBinding(withStages([scan, gated()]), withStages([scan, { ...review, advance: { kind: "governed-decision", condition: "accepted", decisionScope: "wwmd" } }], "1.1.0"));
    expect(diff.changes).toEqual([expect.objectContaining({ kind: "gate-removed", class: "widening", stageKey: "review" })]);
    expect(diff.classification).toBe("widening");
  });

  it("removing a binding is a widening row", () => {
    const diff = diffWorkShapeBinding(withStages([scan, bound()]), withStages([scan, gated()], "1.1.0"));
    expect(diff.changes).toEqual([expect.objectContaining({ kind: "binding-removed", class: "widening", stageKey: "review" })]);
    expect(diff.classification).toBe("widening");
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

// GPP Phase 3c PR-3c-1 (BI-8875C9DF): the graph-construct rows. Each fires only
// when one side declares the field.
describe("Phase 3c rows: flow, deadline, sub-shape", () => {
  const withStage = (stage: Partial<WorkShapeStage>, version = "1.1.0"): WorkShapeDefinitionContract =>
    ({ ...v1, version, stages: [{ ...scan, ...stage }, review] });
  const kinds = (from: WorkShapeDefinitionContract, to: WorkShapeDefinitionContract) =>
    diffWorkShapeBinding(from, to).changes.map((row) => [row.kind, row.class, row.stageKey] as const);
  const flow = { nodes: [], edges: [{ from: "scan", to: "review" }, { from: "review", to: "success" }] };

  it("flow-changed (widening) when either side declares a flow and they differ", () => {
    expect(kinds(v1, { ...v1, version: "1.1.0", flow })).toEqual([["flow-changed", "widening", null]]);
    expect(kinds({ ...v1, flow }, { ...v1, version: "1.1.0" })).toEqual([["flow-changed", "widening", null]]);
    expect(kinds({ ...v1, flow }, { ...v1, version: "1.1.0", flow: { ...flow, edges: [...flow.edges] } })).toEqual([]);
  });

  it("deadline-added (narrowing), deadline-relaxed and deadline-removed (widening)", () => {
    const two = { deadline: { afterDays: 2, description: "two" } };
    const five = { deadline: { afterDays: 5, description: "five" } };
    expect(kinds(withStage({}, "1.0.0"), withStage(two))).toEqual([["deadline-added", "narrowing", "scan"]]);
    expect(kinds(withStage(two, "1.0.0"), withStage(five))).toEqual([["deadline-relaxed", "widening", "scan"]]);
    expect(kinds(withStage(two, "1.0.0"), withStage({}))).toEqual([["deadline-removed", "widening", "scan"]]);
    expect(diffWorkShapeBinding(withStage(two, "1.0.0"), withStage(five)).classification).toBe("widening");
    expect(diffWorkShapeBinding(withStage({}, "1.0.0"), withStage(two)).classification).toBe("narrowing");
  });

  it("sub-shape-changed (widening) when either side calls a sub-shape and the call differs", () => {
    expect(kinds(withStage({}, "1.0.0"), withStage({ subShape: "child@1.0.0" }))).toEqual([["sub-shape-changed", "widening", "scan"]]);
    expect(kinds(withStage({ subShape: "child@1.0.0" }, "1.0.0"), withStage({ subShape: "child@1.1.0" }))).toEqual([["sub-shape-changed", "widening", "scan"]]);
    expect(kinds(withStage({ subShape: "child@1.0.0" }, "1.0.0"), withStage({ subShape: "child@1.0.0" }))).toEqual([]);
  });

  it("a shape declaring none of them gains no row", () => {
    expect(kinds(v1, { ...v1, version: "1.1.0" })).toEqual([]);
  });
});
