// apps/web/lib/govern/data/legacy-coverage-baseline.ts
// BI-DG-002 (spec §6.1): the IMMUTABLE legacy coverage baseline. Every pre-existing
// unresolved model/field goes here with an accountable owner, risk, remediation BI, and
// deadline — NEVER a blanket "internal/standard" classification to make coverage green.
// The baseline can only shrink: coverage waves (BI-DG-015+) resolve entries into the
// registry and delete them here; the ratchet (coverage.ts assertBaselineDidNotGrow)
// forbids growth, transfer to a new object, or hiding a changed object.
//
// GENERATION: the real entries are generated ONCE from parsePrismaSchema over the live
// 495-model schema in BI-DG-002's leased-runtime completion step (a runtime this
// source-only worktree cannot host), so the baseline denominator and the coverage
// test's denominator come from the same parser and never disagree. This file ships the
// TYPE, the ratchet seal, and an empty seed; the runtime step commits the generated
// entries and sets SEALED_BASELINE_COUNT to the sealed length.

export type LegacyCoverageRisk = "low" | "medium" | "high";

export type LegacyCoverageBaselineEntry = {
  /** Physical Prisma model that owns the unresolved field. */
  prismaModel: string;
  /** Physical field name, or "*" for a whole-model gap. */
  field: string;
  /** Accountable owner role for resolving this gap. */
  owner: string;
  risk: LegacyCoverageRisk;
  /** Backlog item that will resolve this gap (a coverage wave, BI-DG-015+). */
  remediationBI: string;
  /** ISO date by which the gap must be resolved. */
  deadline: string;
};

export type LegacyCoverageBaseline = {
  readonly entries: readonly LegacyCoverageBaselineEntry[];
};

// Empty seed. Populated by the runtime generation step (see file header); until then
// the real-schema coverage gate is not wired (only the synthetic-schema unit tests
// exercise the machinery), so CI stays green on the algorithm without a fabricated
// blanket classification.
export const LEGACY_COVERAGE_BASELINE: LegacyCoverageBaseline = Object.freeze({
  entries: Object.freeze([]) as readonly LegacyCoverageBaselineEntry[],
});

/**
 * The sealed baseline length. The ratchet asserts the live baseline never exceeds this.
 * The runtime generation step sets this to the generated entry count when it seals the
 * baseline; every later coverage wave lowers it.
 */
export const SEALED_BASELINE_COUNT = LEGACY_COVERAGE_BASELINE.entries.length;
