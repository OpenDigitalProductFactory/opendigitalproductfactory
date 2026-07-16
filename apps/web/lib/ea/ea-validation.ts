// apps/web/lib/ea/ea-validation.ts
//
// Pure (no prisma / auth / Next.js) validation constants and assertion helpers
// for EA reference-model coverage/proposal statuses. Extracted verbatim from
// lib/actions/ea.ts (BI-OPT-FAT-ACTIONS, EA slice) so the enum guards live in
// the EA domain layer and are unit-testable on their own. Behavior-preserving
// relocation — identical bodies and error messages.

export const REFERENCE_COVERAGE_STATUSES = [
  "implemented",
  "partial",
  "planned",
  "not_started",
  "out_of_mvp",
] as const;

export const REFERENCE_PROPOSAL_STATUSES = [
  "proposed",
  "reviewed",
  "approved",
  "rejected",
  "promoted",
] as const;

export type ReferenceCoverageStatus = (typeof REFERENCE_COVERAGE_STATUSES)[number];
export type ReferenceProposalStatus = (typeof REFERENCE_PROPOSAL_STATUSES)[number];

export function assertCoverageStatus(value: string): asserts value is ReferenceCoverageStatus {
  if (!REFERENCE_COVERAGE_STATUSES.includes(value as ReferenceCoverageStatus)) {
    throw new Error("Invalid coverage status");
  }
}

export function assertProposalStatus(value: string): asserts value is ReferenceProposalStatus {
  if (!REFERENCE_PROPOSAL_STATUSES.includes(value as ReferenceProposalStatus)) {
    throw new Error("Invalid proposal status");
  }
}
