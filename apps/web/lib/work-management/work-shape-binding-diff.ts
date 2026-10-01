// Binding diff between two versions of one work shape (BI-CB5C0DCE, phase 2).
//
// GPP §2.1.1: narrowing a binding, or making explicit what its envelope already
// admits, may apply to pinned work; widening takes a new binding version and a
// fresh gate decision. This classifies a version change so the rebind action
// knows which of the two it is looking at. Stages match by key: a stage keeps
// its key across versions, or it is a different stage.
// Spec: docs/superpowers/specs/2026-10-01-workroom-shape-rebind-design.md §4.2

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
  | "grant-removed";

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
