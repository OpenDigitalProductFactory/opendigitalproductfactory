// apps/web/lib/gpp/shape-language/emit.ts
//
// Lowering: GPP shape document → WorkShapeDefinition, the object half of the
// compiler's emit step. Design: docs/superpowers/specs/
// 2026-10-02-gpp-shape-notation-and-compiler-design.md §7.1 step 5, §7.4 (L1,
// L2); plan: docs/superpowers/plans/
// 2026-10-02-gpp-shape-notation-compiler-phase-3.md (PR-3a-3, BI-6DA17863,
// "spec refinement 1": 3a needs the object half of emit; the TypeScript text
// emitter and the DRC pipeline are PR-3b-4).
//
// `lowerToDefinition` drops `format` and builds the definition in
// WorkShapeDefinition declaration order, copying every value, so the result
// shares no object with the document. A §4.4 additive field (`advance.gate`,
// `stage.binding`, `stage.deadline`, `stage.subShape`, `flow`) is carried only
// when the document declares it, so an absent field stays absent and the
// legacy projection (legacy.ts) gives back exactly today's definition.
//
// The input is a parsed document. This module does not validate: the compile
// pipeline (PR-3b-1) parses against gppShapeDocumentSchema first.
//
// OFFLINE TOOLING in Phase 3a: nothing in the running app imports this module.

import type { GppGate, GppShapeDocument } from "./gpp-shape-schema";

/**
 * A WorkShapeDefinition that may carry the §4.4 additive fields. Structurally
 * a shape document without `format`; gpp-shape-schema.ts asserts at compile
 * time that this is assignable to WorkShapeDefinition (every added field is
 * optional). WorkShapeDefinition gains `gate?` and `binding?` in PR-3b-4.
 */
export type LoweredWorkShapeDefinition = Omit<GppShapeDocument, "format">;

type DocumentStage = GppShapeDocument["stages"][number];
type DocumentAdvance = DocumentStage["advance"];

/** A plain-JSON deep copy. Every value in a parsed document is plain JSON. */
function copyJson<T>(value: T): T {
  return structuredClone(value);
}

/**
 * A copy of a gate in schema field order, optional fields only when present.
 * Shared by the decompiler (from the ratification table) and the lowering.
 */
export function copyGate(gate: GppGate): GppGate {
  return {
    authority: gate.authority,
    ...(gate.gateKey !== undefined ? { gateKey: gate.gateKey } : {}),
    mode: gate.mode,
    blocking: gate.blocking,
    resolution: gate.resolution,
    ...(gate.resolver !== undefined
      ? { resolver: { module: gate.resolver.module, exportName: gate.resolver.exportName } }
      : {}),
    ...(gate.advisory !== undefined ? { advisory: gate.advisory.map((consult) => copyJson(consult)) } : {}),
    ...(gate.checkpoint !== undefined
      ? { checkpoint: { role: gate.checkpoint.role, exactAction: gate.checkpoint.exactAction } }
      : {}),
    ...(gate.escalation !== undefined
      ? { escalation: { role: gate.escalation.role, whileWaiting: gate.escalation.whileWaiting } }
      : {}),
    ...(gate.onRefuse !== undefined ? { onRefuse: gate.onRefuse } : {}),
  };
}

function lowerAdvance(advance: DocumentAdvance): DocumentAdvance {
  if (advance.kind === "status-change") return { kind: advance.kind, condition: advance.condition };
  const lowered: DocumentAdvance = {
    kind: advance.kind,
    condition: advance.condition,
    decisionScope: advance.decisionScope,
  };
  if (advance.gate !== undefined) lowered.gate = copyGate(advance.gate);
  return lowered;
}

function lowerStage(stage: DocumentStage): DocumentStage {
  const lowered: DocumentStage = {
    key: stage.key,
    title: stage.title,
    accountablePrincipalRef: stage.accountablePrincipalRef,
    advance: lowerAdvance(stage.advance),
    evidence: [...stage.evidence],
  };
  // Absent means undeclared; [] is a declaration that the stage reaches nothing.
  if (stage.tools !== undefined) lowered.tools = [...stage.tools];
  if (stage.binding !== undefined) lowered.binding = copyJson(stage.binding);
  if (stage.deadline !== undefined) lowered.deadline = { afterDays: stage.deadline.afterDays, description: stage.deadline.description };
  if (stage.subShape !== undefined) lowered.subShape = stage.subShape;
  return lowered;
}

/** Document → definition. Drops `format`; fresh objects throughout. */
export function lowerToDefinition(document: GppShapeDocument): LoweredWorkShapeDefinition {
  return {
    key: document.key,
    version: document.version,
    title: document.title,
    description: document.description,
    triggers: [...document.triggers],
    stages: document.stages.map(lowerStage),
    // `flow` is not yet a WorkShapeDefinition field (it arrives with the Phase 3c
    // PR that makes it executable); it sits after `stages`, as in the schema.
    ...(document.flow !== undefined ? { flow: copyJson(document.flow) } : {}),
    stopConditions: document.stopConditions.map((stop) => ({
      kind: stop.kind,
      condition: stop.condition,
      disposition: stop.disposition,
    })),
    grants: [...document.grants],
    measures: document.measures.map((measure) => ({ key: measure.key, description: measure.description })),
    budgets: document.budgets.map((budget) => ({ kind: budget.kind, limit: budget.limit, unit: budget.unit })),
    reviewPoint: { everyDays: document.reviewPoint.everyDays, description: document.reviewPoint.description },
    collaborationShape: document.collaborationShape,
  };
}
