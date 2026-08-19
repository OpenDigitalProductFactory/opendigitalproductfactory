import type { Prisma } from "@dpf/db";

export const OWNER_CHANGE_EVIDENCE_REVISION_QUERY = {
  where: {
    field: { in: ["acceptanceMet", "uxTestResults"] },
    status: "accepted",
  },
  orderBy: { createdAt: "desc" },
  distinct: ["field"],
  select: {
    field: true,
    createdAt: true,
  },
} satisfies Prisma.BuildArtifactRevisionFindManyArgs;

type OwnerEvidenceRevision = {
  field: string;
  createdAt: Date;
};

export type OwnerEvidenceObservedAt = {
  acceptance: string | null;
  ux: string | null;
};

export function ownerEvidenceObservedAtFromRevisions(
  revisions: readonly OwnerEvidenceRevision[] | null | undefined,
): OwnerEvidenceObservedAt {
  const observedAt: OwnerEvidenceObservedAt = { acceptance: null, ux: null };

  for (const revision of revisions ?? []) {
    if (revision.field === "acceptanceMet" && observedAt.acceptance === null) {
      observedAt.acceptance = revision.createdAt.toISOString();
    }
    if (revision.field === "uxTestResults" && observedAt.ux === null) {
      observedAt.ux = revision.createdAt.toISOString();
    }
  }

  return observedAt;
}
