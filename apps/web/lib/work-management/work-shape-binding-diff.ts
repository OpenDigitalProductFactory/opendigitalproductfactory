// Binding diff between two versions of one work shape (BI-CB5C0DCE, phase 2).
//
// GPP §2.1.1: narrowing a binding, or making explicit what its envelope already
// admits, may apply to pinned work; widening takes a new binding version and a
// fresh gate decision. This classifies a version change so the rebind action
// knows which of the two it is looking at. Stages match by key: a stage keeps
// its key across versions, or it is a different stage.
// Spec: docs/superpowers/specs/2026-10-01-workroom-shape-rebind-design.md §4.2
//
// Typed gate and binding rows (GPP shape compiler, BI-6DA17863 PR-3b-4; spec
// docs/superpowers/specs/2026-10-02-gpp-shape-notation-and-compiler-design.md
// §4.4, §6.4). WorkShapeStage.binding and a governed advance's `gate` are
// optional, additive fields. A row about them fires ONLY when both versions
// carry the field. Absent -> present is a making-explicit transition (GPP
// §2.1.1: it admits nothing the drive did not already do), so it is not a
// change and the classification stays `unchanged`; the GPP shape compiler's
// proof migration relies on that. Present -> absent is NOT symmetric: removing
// a stated gate or binding withdraws a control, which GPP §2.1.1 treats as
// widening. No runtime reader consumes either field today, but the row is
// recorded now so the classification is already right when Phase 3c makes
// gates executable (highest-governance reading; the plan was silent on it). Binding enforcement is ordered absent < shadow < enforced <
// environment (a containment boundary with declared egress is the strictest).

import type { WorkShapeDefinitionContract, WorkShapeStage } from "./work-shapes";

export type BindingChangeClass = "widening" | "narrowing" | "unchanged";

export type BindingChangeKind =
  | "stage-added"
  | "stage-removed"
  | "tool-added"
  | "tool-removed"
  | "evidence-added"
  | "evidence-removed"
  | "accountable-changed"
  | "advance-relaxed"
  | "advance-tightened"
  | "text-changed"
  | "grant-added"
  | "grant-removed"
  | "gate-mode-relaxed"
  | "gate-blocking-relaxed"
  | "gate-authority-changed"
  | "binding-enforcement-raised"
  | "binding-enforcement-lowered"
  | "binding-version-changed"
  | "gate-removed"
  | "binding-removed";

export type BindingChange = {
  kind: BindingChangeKind;
  class: Exclude<BindingChangeClass, "unchanged">;
  /** Null for shape-level changes (grants). */
  stageKey: string | null;
  detail: string;
};

export type WorkShapeBindingDiff = {
  shapeKey: string;
  fromVersion: string;
  toVersion: string;
  classification: BindingChangeClass;
  changes: BindingChange[];
};

const CLASS_OF: Record<BindingChangeKind, Exclude<BindingChangeClass, "unchanged">> = {
  "stage-added": "widening",
  "tool-added": "widening",
  "evidence-added": "widening",
  "accountable-changed": "widening",
  "advance-relaxed": "widening",
  "grant-added": "widening",
  "stage-removed": "narrowing",
  "tool-removed": "narrowing",
  "evidence-removed": "narrowing",
  "advance-tightened": "narrowing",
  "text-changed": "narrowing",
  "grant-removed": "narrowing",
  "gate-mode-relaxed": "widening",
  "gate-blocking-relaxed": "widening",
  "gate-authority-changed": "widening",
  "binding-enforcement-lowered": "widening",
  "binding-version-changed": "widening",
  "gate-removed": "widening",
  "binding-removed": "widening",
  "binding-enforcement-raised": "narrowing",
};

const ENFORCEMENT_RANK: Record<NonNullable<WorkShapeStage["binding"]>["enforcement"], number> = {
  absent: 0,
  shadow: 1,
  enforced: 2,
  environment: 3,
};

function change(kind: BindingChangeKind, stageKey: string | null, detail: string): BindingChange {
  return { kind, class: CLASS_OF[kind], stageKey, detail };
}

function setDiff(from: readonly string[], to: readonly string[]): { added: string[]; removed: string[] } {
  const before = new Set(from);
  const after = new Set(to);
  return {
    added: [...after].filter((item) => !before.has(item)).sort(),
    removed: [...before].filter((item) => !after.has(item)).sort(),
  };
}

function stageChanges(from: WorkShapeStage, to: WorkShapeStage): BindingChange[] {
  const changes: BindingChange[] = [];
  const tools = setDiff(from.tools ?? [], to.tools ?? []);
  for (const tool of tools.added) changes.push(change("tool-added", to.key, tool));
  for (const tool of tools.removed) changes.push(change("tool-removed", to.key, tool));
  const evidence = setDiff(from.evidence, to.evidence);
  for (const kind of evidence.added) changes.push(change("evidence-added", to.key, kind));
  for (const kind of evidence.removed) changes.push(change("evidence-removed", to.key, kind));
  if (from.accountablePrincipalRef !== to.accountablePrincipalRef) {
    changes.push(change("accountable-changed", to.key, `${from.accountablePrincipalRef} -> ${to.accountablePrincipalRef}`));
  }
  if (from.advance.kind !== to.advance.kind) {
    // A governed decision downgraded to a status change removes a gate; the reverse adds one.
    changes.push(change(
      to.advance.kind === "status-change" ? "advance-relaxed" : "advance-tightened",
      to.key,
      `${from.advance.kind} -> ${to.advance.kind}`,
    ));
  } else if (from.advance.condition !== to.advance.condition || from.title !== to.title) {
    changes.push(change("text-changed", to.key, "title or advance condition"));
  }
  changes.push(...gateChanges(from, to), ...bindingChanges(from, to));
  return changes;
}

/** Rows for a typed gate. Added: no row; removed: widening; both present: compared (see header). */
function gateChanges(from: WorkShapeStage, to: WorkShapeStage): BindingChange[] {
  const before = from.advance.kind === "governed-decision" ? from.advance.gate : undefined;
  const after = to.advance.kind === "governed-decision" ? to.advance.gate : undefined;
  if (before && !after) return [change("gate-removed", to.key, `${before.authority} gate`)];
  if (!before || !after) return [];
  const changes: BindingChange[] = [];
  if (before.mode === "enforced" && after.mode === "shadow") {
    changes.push(change("gate-mode-relaxed", to.key, `${before.mode} -> ${after.mode}`));
  }
  if (before.blocking && !after.blocking) {
    changes.push(change("gate-blocking-relaxed", to.key, "blocking -> non-blocking"));
  }
  if (before.authority !== after.authority) {
    changes.push(change("gate-authority-changed", to.key, `${before.authority} -> ${after.authority}`));
  }
  return changes;
}

/** Rows for a stage binding. Added: no row; removed: widening; both present: compared (see header). */
function bindingChanges(from: WorkShapeStage, to: WorkShapeStage): BindingChange[] {
  const before = from.binding;
  const after = to.binding;
  if (before && !after) return [change("binding-removed", to.key, `${before.id}@${before.version}`)];
  if (!before || !after) return [];
  const changes: BindingChange[] = [];
  const delta = ENFORCEMENT_RANK[after.enforcement] - ENFORCEMENT_RANK[before.enforcement];
  if (delta > 0) changes.push(change("binding-enforcement-raised", to.key, `${before.enforcement} -> ${after.enforcement}`));
  if (delta < 0) changes.push(change("binding-enforcement-lowered", to.key, `${before.enforcement} -> ${after.enforcement}`));
  if (before.version !== after.version) {
    changes.push(change("binding-version-changed", to.key, `${before.id}@${before.version} -> ${after.id}@${after.version}`));
  }
  return changes;
}

/** Classify the change from `from` to `to`. Any widening row makes the whole diff a widening. */
export function diffWorkShapeBinding(
  from: WorkShapeDefinitionContract,
  to: WorkShapeDefinitionContract,
): WorkShapeBindingDiff {
  if (from.key !== to.key) {
    throw new Error(`diffWorkShapeBinding compares versions of one shape, not ${from.key} and ${to.key}.`);
  }
  const changes: BindingChange[] = [];
  const before = new Map(from.stages.map((stage) => [stage.key, stage]));
  const after = new Map(to.stages.map((stage) => [stage.key, stage]));
  for (const stage of to.stages) {
    const prior = before.get(stage.key);
    if (!prior) changes.push(change("stage-added", stage.key, stage.title));
    else changes.push(...stageChanges(prior, stage));
  }
  for (const stage of from.stages) {
    if (!after.has(stage.key)) changes.push(change("stage-removed", stage.key, stage.title));
  }
  const grants = setDiff(from.grants, to.grants);
  for (const grant of grants.added) changes.push(change("grant-added", null, grant));
  for (const grant of grants.removed) changes.push(change("grant-removed", null, grant));

  const classification: BindingChangeClass = changes.some((row) => row.class === "widening")
    ? "widening"
    : changes.length > 0 ? "narrowing" : "unchanged";
  return { shapeKey: to.key, fromVersion: from.version, toVersion: to.version, classification, changes };
}
