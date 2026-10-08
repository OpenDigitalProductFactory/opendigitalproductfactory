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
// pipeline (compile.ts) parses, resolves and runs the design rules first, and
// emits only when no finding is an error.
//
// `emitShapeModule` (PR-3b-4) is the TypeScript-text half of emit: the
// generated module the runtime would import, written as
// `export const <KEY>_<VERSION> = { … } as const satisfies WorkShapeDefinition;`
// so `tsc` checks an emitted shape exactly as it checks a hand-written one
// (spec §4.5: a JSON import would widen `evidence` and `collaborationShape`
// to `string`). Deterministic by construction: keys in WorkShapeDefinition
// declaration order (the lowering's insertion order), strings escaped by
// JSON.stringify, two-space indent, LF only, one trailing newline, and no
// timestamp. The header names the source document and the sha256 of its
// canonical JSON, which the caller computes (compile.ts).
//
// OFFLINE TOOLING in Phase 3: nothing in the running app imports this module.

import type { WorkShapeBinding, WorkShapeGate } from "@/lib/work-management/work-shapes";

import type { GppBinding, GppGate, GppShapeDocument } from "./gpp-shape-schema";

/**
 * A WorkShapeDefinition that may carry the §4.4 additive fields. Structurally
 * a shape document without `format`; gpp-shape-schema.ts asserts at compile
 * time that this is assignable to WorkShapeDefinition (every added field is
 * optional). WorkShapeDefinition carries `gate?` and `binding?` since PR-3b-4,
 * and `deadline?`, `subShape?` and `flow?` since Phase 3c PR-3c-1; the compile
 * pipeline still refuses each of those three until its flag is on
 * (E-NOT-EXECUTABLE).
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
 * Shared by the decompiler (from the ratification table, or a definition's
 * own declared refuse-route gate since Phase 3c) and the lowering.
 */
export function copyGate(gate: GppGate | WorkShapeGate): GppGate {
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

/**
 * A copy of a stage binding in schema field order, optional fields only when
 * present. Shared by the decompiler and the lowering (PR-3b-4).
 */
export function copyBinding(binding: WorkShapeBinding): GppBinding {
  const common = {
    id: binding.id,
    version: binding.version,
  };
  const rest = {
    ...(binding.subjectScope !== undefined ? { subjectScope: binding.subjectScope } : {}),
    ...(binding.validity !== undefined
      ? {
          validity: {
            until: binding.validity.until,
            ...(binding.validity.maxDuration !== undefined ? { maxDuration: binding.validity.maxDuration } : {}),
          },
        }
      : {}),
  };
  if (binding.enforcement === "environment") {
    return { ...common, enforcement: binding.enforcement, ...rest, egress: [...binding.egress] };
  }
  return {
    ...common,
    enforcement: binding.enforcement,
    ...rest,
    ...(binding.egress !== undefined ? { egress: [...binding.egress] } : {}),
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
  if (stage.mandatedTools !== undefined) lowered.mandatedTools = [...stage.mandatedTools];
  if (stage.binding !== undefined) lowered.binding = copyBinding(stage.binding);
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
    // `flow` sits after `stages`, as in the schema; WorkShapeDefinition carries
    // it since Phase 3c PR-3c-1.
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

// ── TypeScript text (PR-3b-4) ────────────────────────────────────────────────

export const GPP_SHAPE_COMPILER_ID = "gpp-shape-compiler 0.1";

/** The generated module's import of the definition type, relative to apps/web/lib/work-management/generated/. */
export const GENERATED_SHAPE_TYPE_IMPORT = "../work-shapes";

/** `inquiry-response-watch` + `1.0.0` → `INQUIRY_RESPONSE_WATCH_1_0_0`. */
export function shapeConstantName(key: string, version: string): string {
  return `${key}_${version}`.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function literalKey(key: string): string {
  return IDENTIFIER.test(key) ? key : JSON.stringify(key);
}

/** A TypeScript literal for a plain-JSON value, at `depth` levels of two-space indent. */
function literal(value: unknown, depth: number): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`emitShapeModule: a non-finite number cannot be emitted (${value}).`);
    return JSON.stringify(value);
  }
  const inner = "  ".repeat(depth + 1);
  const outer = "  ".repeat(depth);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `[\n${value.map((item) => `${inner}${literal(item, depth + 1)},`).join("\n")}\n${outer}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined);
    if (entries.length === 0) return "{}";
    return `{\n${entries.map(([key, item]) => `${inner}${literalKey(key)}: ${literal(item, depth + 1)},`).join("\n")}\n${outer}}`;
  }
  throw new Error(`emitShapeModule: a ${typeof value} cannot be emitted.`);
}

export type EmitShapeModuleOptions = {
  /** The source document, repo-relative with forward slashes. */
  sourcePath: string;
  /** `sha256:<hex>` over canonicalJson(document). */
  digest: string;
};

/**
 * The generated TypeScript module for a lowered definition. The definition's
 * own key order is kept, so pass the output of lowerToDefinition (declaration
 * order); an `undefined` member is omitted, never written.
 */
export function emitShapeModule(definition: LoweredWorkShapeDefinition, options: EmitShapeModuleOptions): string {
  if (/[\r\n]/.test(options.sourcePath) || /[\r\n]/.test(options.digest)) {
    throw new Error("emitShapeModule: sourcePath and digest are single-line values.");
  }
  return [
    `// @generated by ${GPP_SHAPE_COMPILER_ID} from`,
    `//   ${options.sourcePath}`,
    `//   ${options.digest}`,
    "// Do not edit. `pnpm --filter web check:gpp-shapes` fails if this file differs from a fresh compile.",
    `import type { WorkShapeDefinition } from "${GENERATED_SHAPE_TYPE_IMPORT}";`,
    "",
    `export const ${shapeConstantName(definition.key, definition.version)} = ${literal(definition, 0)} as const satisfies WorkShapeDefinition;`,
    "",
  ].join("\n");
}
