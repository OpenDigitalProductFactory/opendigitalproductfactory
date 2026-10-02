// apps/web/lib/gpp/shape-language/legacy.ts
//
// The legacy projection that property L1 compares under. Design:
// docs/superpowers/specs/2026-10-02-gpp-shape-notation-and-compiler-design.md
// §4.4 (the five additive fields), §7.4 (L1: `legacy(compile(decompile(S))) ≡ S`
// where `legacy` drops only the new optional fields); plan:
// docs/superpowers/plans/2026-10-02-gpp-shape-notation-compiler-phase-3.md
// (PR-3a-3, BI-6DA17863; "spec refinement 5": AC-NODISRUPT equality is read
// under this projection).
//
// `legacyProjection` removes exactly `flow`, `stage.binding`, `stage.deadline`,
// `stage.subShape` and `advance.gate`. Every other key, known or not, is kept,
// so equality under the projection can never hide a lost or an extra existing
// field. `legacyDroppedFields` lists what the projection removes, from the same
// field list, so the ratification report (property R) and L1 cannot drift.
//
// OFFLINE TOOLING in Phase 3a: nothing in the running app imports this module.

import type { WorkShapeDefinition } from "@/lib/work-management/work-shapes";

/** §4.4: fields a shape document adds to WorkShapeDefinition, by level. */
export const LEGACY_DROPPED_SHAPE_FIELDS = ["flow"] as const;
export const LEGACY_DROPPED_STAGE_FIELDS = ["binding", "deadline", "subShape"] as const;
export const LEGACY_DROPPED_ADVANCE_FIELDS = ["gate"] as const;

export type LegacyDroppedField = {
  /** The stage key, or null for a shape-level field. */
  stage: string | null;
  /** `flow`, `binding`, `deadline`, `subShape` or `advance.gate`. */
  field: string;
  value: unknown;
};

type LooseObject = Record<string, unknown>;

/** A shallow copy of `source` without `keys`, preserving the order of the rest. */
function without(source: object, keys: readonly string[]): LooseObject {
  const copy: LooseObject = {};
  for (const [key, value] of Object.entries(source)) {
    if (!keys.includes(key)) copy[key] = value;
  }
  return copy;
}

/**
 * The definition with the §4.4 additive fields removed and nothing else. Fresh
 * objects down to each advance; deeper values are shared with the input, which
 * is never mutated.
 */
export function legacyProjection(definition: WorkShapeDefinition): WorkShapeDefinition {
  const projected = without(definition, LEGACY_DROPPED_SHAPE_FIELDS);
  projected.stages = definition.stages.map((stage) => {
    const stageCopy = without(stage, LEGACY_DROPPED_STAGE_FIELDS);
    stageCopy.advance = without(stage.advance, LEGACY_DROPPED_ADVANCE_FIELDS);
    return stageCopy;
  });
  return projected as WorkShapeDefinition;
}

/** Every field `legacyProjection` removes, in document order: shape fields, then each stage's. */
export function legacyDroppedFields(definition: WorkShapeDefinition): LegacyDroppedField[] {
  const dropped: LegacyDroppedField[] = [];
  const shape = definition as unknown as LooseObject;
  for (const field of LEGACY_DROPPED_SHAPE_FIELDS) {
    if (Object.hasOwn(shape, field)) dropped.push({ stage: null, field, value: shape[field] });
  }
  for (const stage of definition.stages) {
    const stageFields = stage as unknown as LooseObject;
    for (const field of LEGACY_DROPPED_STAGE_FIELDS) {
      if (Object.hasOwn(stageFields, field)) dropped.push({ stage: stage.key, field, value: stageFields[field] });
    }
    const advance = stage.advance as unknown as LooseObject;
    for (const field of LEGACY_DROPPED_ADVANCE_FIELDS) {
      if (Object.hasOwn(advance, field)) dropped.push({ stage: stage.key, field: `advance.${field}`, value: advance[field] });
    }
  }
  return dropped;
}
