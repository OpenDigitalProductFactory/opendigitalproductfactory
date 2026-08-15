// Phase 1 Task 1.10 of the principles-as-wiki-kind plan: canonical list
// of the 12 principle-specific lint finding kinds with admin-UI labels.
// Imported by the admin lint filter chip group.
//
// Spec: docs/superpowers/specs/2026-05-12-principles-as-wiki-kind-design.md §14
// Plan: docs/superpowers/plans/2026-05-12-principles-as-wiki-kind.md (Phase 1 Task 1.10)
//
// Order: surface-required errors first (block publish), then warns. Within
// each severity bucket, list in the order an author meets them — e.g., you
// declare a tier before a direction before a vector before applies-to.

export type PrincipleFindingKindOption = {
  value: string;
  label: string;
  /** True when the underlying detector emits severity: "error" by default. */
  blocking: boolean;
};

export const PRINCIPLE_FINDING_KIND_OPTIONS: PrincipleFindingKindOption[] = [
  // ─── Errors (block publish) ─────────────────────────────────────────────
  {
    value: "principle-missing-tier",
    label: "Missing tier",
    blocking: true,
  },
  {
    value: "principle-missing-direction",
    label: "Missing direction",
    blocking: true,
  },
  {
    value: "principle-missing-vector",
    label: "Missing vector",
    blocking: true,
  },
  {
    value: "principle-missing-applies-to",
    label: "Missing applies-to",
    blocking: true,
  },
  {
    value: "principle-unknown-dimension",
    label: "Unknown dimension",
    blocking: true,
  },
  {
    value: "principle-public-unsafe-marker",
    label: "Public safety",
    blocking: true,
  },

  // ─── Warns (do not block) ───────────────────────────────────────────────
  {
    value: "principle-sparse-vector",
    label: "Sparse vector",
    blocking: false,
  },
  {
    value: "principle-tier-weight-mismatch",
    label: "Tier-weight mismatch",
    blocking: false,
  },
  {
    value: "principle-vector-dimension-mismatch",
    label: "Vector-dimension mismatch",
    blocking: false,
  },
  {
    value: "principle-public-missing-rationale",
    label: "Public missing rationale",
    blocking: false,
  },
  {
    value: "principle-duplicate",
    label: "Duplicate",
    blocking: false,
  },
  {
    value: "principle-contradiction-review",
    label: "Contradiction review",
    blocking: false,
  },
];

/** Set of finding-kind values for `findingKind in PRINCIPLE_FINDING_KIND_SET`. */
export const PRINCIPLE_FINDING_KIND_SET = new Set(
  PRINCIPLE_FINDING_KIND_OPTIONS.map((o) => o.value),
);

/** Does this finding-kind value belong to the principle family? */
export function isPrincipleFindingKind(value: string): boolean {
  return PRINCIPLE_FINDING_KIND_SET.has(value);
}
