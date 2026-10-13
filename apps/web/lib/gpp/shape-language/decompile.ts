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
// - Copies `flow`, `stage.deadline` and `stage.subShape` when the definition
//   carries them (Phase 3c PR-3c-1, design correction 5: WorkShapeDefinition
//   carries all three since then). A sequential definition carries none, so
//   its document is unchanged. Without this the Phase 3c registry guard
//   (work-shape-graph-constructs.test.ts) could not see a hand-declared graph
//   construct, and L1 would fail for such a shape.
// - Copies `stage.binding` when the definition carries one, in schema order
//   (WorkShapeStage.binding exists since PR-3b-4; no registry shape has one).
//   This keeps L2, decompile(compile(D)) ≡ D, true for a bound document.
// - `advance.gate` comes from a ratified GATE_RATIFICATION entry for the
//   stage's `decisionScope`, with one exception (Phase 3c PR-3c-1, design
//   correction 12): a gate the definition declares itself WITH a refuse route
//   (`onRefuse`) wins, so a code-declared refuse route reaches the registry
//   guard (work-shape-graph-constructs.test.ts) and E-NOT-EXECUTABLE; D-8
//   still compares that gate with the ratified entry. A refuse route is
//   `onRefuse`, or (Phase 3c PR-3c-3) the stage's single outgoing rework edge
//   (declaresRefuseRoute, work-shape-flow-graph.ts): the drive and the
//   reference interpreter route a refusal over that edge only through the
//   gate, so a document without it would misstate the shape. A declared gate
//   without a refuse route is not carried: since PR-3b-6 the compiled
//   inquiry-response-watch declares the very gate its ratified entry holds,
//   and the decompiler's contract (and its tests) is that, absent a refuse
//   route, the gate is the table's. A stage whose scope is not ratified is
//   returned in `awaitingRatification` either way; a shape with any such stage
//   is not migrated (§10).
// - `tools` absent stays absent; `tools: []` stays `[]`.
// - Emits no layout: the canvas lays out a sidecar-less document (Phase 4).
//
// OFFLINE TOOLING in Phase 3a: nothing in the running app imports this module.

import { declaresRefuseRoute } from "@/lib/work-management/work-shape-flow-graph";
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
  hasRefuseRoute: boolean,
): DocumentAdvance {
  const { advance } = stage;
  if (advance.kind === "status-change") return { kind: advance.kind, condition: advance.condition };
  const typed: DocumentAdvance = {
    kind: advance.kind,
    condition: advance.condition,
    decisionScope: advance.decisionScope,
  };
  const ratified = ratifiedGateFor(advance.decisionScope, table);
  const gate = advance.gate && hasRefuseRoute ? advance.gate : ratified;
  if (gate) typed.gate = copyGate(gate);
  if (!ratified) awaitingRatification.push(stage.key);
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
      advance: decompileAdvance(stage, table, awaitingRatification, declaresRefuseRoute(definition, stage.key)),
      evidence: [...stage.evidence],
    };
    if (stage.tools !== undefined) documentStage.tools = [...stage.tools];
    if (stage.mandatedTools !== undefined) documentStage.mandatedTools = [...stage.mandatedTools];
    if (stage.binding !== undefined) documentStage.binding = copyBinding(stage.binding);
    if (stage.deadline !== undefined) documentStage.deadline = { afterDays: stage.deadline.afterDays, description: stage.deadline.description };
    if (stage.subShape !== undefined) documentStage.subShape = stage.subShape;
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
    ...(definition.flow !== undefined
      ? {
          flow: {
            nodes: definition.flow.nodes.map((node) => ({
              id: node.id,
              type: node.type,
              ...(node.pairs !== undefined ? { pairs: node.pairs } : {}),
            })),
            edges: definition.flow.edges.map((edge) => ({
              from: edge.from,
              to: edge.to,
              ...(edge.rework !== undefined ? { rework: { maxIterations: edge.rework.maxIterations } } : {}),
            })),
          },
        }
      : {}),
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
