// apps/web/lib/gpp/shape-language/decompile.ts
//
// The decompiler: WorkShapeDefinition → GPP shape document, the inverse of
// emit. Design: docs/superpowers/specs/
// 2026-10-02-gpp-shape-notation-and-compiler-design.md §7.3 (decompiler), §7.4
// (L1, L2), §10 step 1; plan: docs/superpowers/plans/
// 2026-10-02-gpp-shape-notation-compiler-phase-3.md (PR-3a-3, BI-6DA17863).
//
// - Copies every current field verbatim, in the schema's order, prefixed by
//   `format: "gpp-shape/0.1"`. Values are copied, never shared, so a document
//   can be edited without touching the registry.
// - Never emits `flow` (every current shape is sequential), `deadline` or
//   `subShape` (no current shape has them, and WorkShapeDefinition does not
//   carry them until the Phase 3c PR that makes each executable).
// - Copies `stage.binding` when the definition carries one, in schema order
//   (WorkShapeStage.binding exists since PR-3b-4; no registry shape has one).
//   This keeps L2, decompile(compile(D)) ≡ D, true for a bound document.
// - Adds `advance.gate` ONLY from a ratified GATE_RATIFICATION entry for the
//   stage's `decisionScope`. Otherwise the advance stays untyped and the stage
//   is returned in `awaitingRatification`; a shape with any such stage is not
//   migrated (§10).
// - `tools` absent stays absent; `tools: []` stays `[]`.
// - Emits no layout: the canvas lays out a sidecar-less document (Phase 4).
//
// OFFLINE TOOLING in Phase 3a: nothing in the running app imports this module.

import type { WorkShapeDefinition, WorkShapeStage } from "@/lib/work-management/work-shapes";

import { copyBinding, copyGate } from "./emit";
import { GATE_RATIFICATION, ratifiedGateFor, type GateRatificationEntry } from "./gate-ratification";
import { GPP_SHAPE_FORMAT, type GppShapeDocument } from "./gpp-shape-schema";

export type DecompileOptions = {
  /** The ratification table to read. Defaults to GATE_RATIFICATION; tests inject one. */
  ratification?: Readonly<Record<string, GateRatificationEntry>>;
};

export type DecompileResult = {
  document: GppShapeDocument;
  /** Keys of governed-decision stages whose scope is not ratified, in stage order. */
  awaitingRatification: string[];
};

type DocumentStage = GppShapeDocument["stages"][number];
type DocumentAdvance = DocumentStage["advance"];

function decompileAdvance(
  stage: WorkShapeStage,
  table: Readonly<Record<string, GateRatificationEntry>>,
  awaitingRatification: string[],
): DocumentAdvance {
  const { advance } = stage;
  if (advance.kind === "status-change") return { kind: advance.kind, condition: advance.condition };
  const typed: DocumentAdvance = {
    kind: advance.kind,
    condition: advance.condition,
    decisionScope: advance.decisionScope,
  };
  const gate = ratifiedGateFor(advance.decisionScope, table);
  if (gate) typed.gate = copyGate(gate);
  else awaitingRatification.push(stage.key);
  return typed;
}

/** Definition → document. Pure; the definition and the table are only read. */
export function decompile(definition: WorkShapeDefinition, options: DecompileOptions = {}): DecompileResult {
  const table = options.ratification ?? GATE_RATIFICATION;
  const awaitingRatification: string[] = [];

  const stages = definition.stages.map((stage): DocumentStage => {
    const documentStage: DocumentStage = {
      key: stage.key,
      title: stage.title,
      accountablePrincipalRef: stage.accountablePrincipalRef,
      advance: decompileAdvance(stage, table, awaitingRatification),
      evidence: [...stage.evidence],
    };
    if (stage.tools !== undefined) documentStage.tools = [...stage.tools];
    if (stage.binding !== undefined) documentStage.binding = copyBinding(stage.binding);
    return documentStage;
  });

  const document: GppShapeDocument = {
    format: GPP_SHAPE_FORMAT,
    key: definition.key,
    version: definition.version,
    title: definition.title,
    description: definition.description,
    triggers: [...definition.triggers],
    stages,
    stopConditions: definition.stopConditions.map((stop) => ({
      kind: stop.kind,
      condition: stop.condition,
      disposition: stop.disposition,
    })),
    grants: [...definition.grants],
    measures: definition.measures.map((measure) => ({ key: measure.key, description: measure.description })),
    budgets: definition.budgets.map((budget) => ({ kind: budget.kind, limit: budget.limit, unit: budget.unit })),
    reviewPoint: { everyDays: definition.reviewPoint.everyDays, description: definition.reviewPoint.description },
    collaborationShape: definition.collaborationShape,
  };

  return { document, awaitingRatification };
}
