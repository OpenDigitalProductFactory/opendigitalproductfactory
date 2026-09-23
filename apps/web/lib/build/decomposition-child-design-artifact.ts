// apps/web/lib/build/decomposition-child-design-artifact.ts
//
// BI-0B7C1A9E — the sibling of BI-FF8ABFCB, one field over.
//
// Decomposition children are created directly in `plan` (approve-decomposition.ts)
// with the derived designDoc written onto the FeatureBuild column. They never
// pass through `reviewDesignDoc`, which is the only other place a designDoc
// BuildArtifactRevision is written.
//
// Initiative readiness resolves CANONICAL_DESIGN_REQUIRED through
// BuildArtifactRevision(field='designDoc', status='accepted') — never through
// the column. So a child's design is real, reviewed, and invisible to
// governance: `plan → build` can never pass, and nothing later creates the
// revision, so it never recovers on its own.
//
// Observed live 2026-09-22 on this install: 49 decomposition children, 0
// artifact revisions between them, 42 wedged in `plan`, and 5,032 gate-blocked
// resume attempts in a single 24h window.
//
// Two paths, mirroring the intake fix:
//   - fix-forward: approveDecomposition mints the revision at child-creation.
//   - self-heal:   the plan resume path backfills already-created children.

import { saveBuildArtifactRevision } from "@/lib/build/build-artifact-provenance";

export type HealChildDesignArtifactInput = {
  child: {
    buildId: string;
    parentEpicId: string;
    designDoc: unknown;
    createdById: string | null;
  };
};

/**
 * Backfill a decomposition child's canonical design artifact.
 *
 * Returns true when it wrote one, false when there was nothing to do — no
 * design to record, or an accepted revision already present. Idempotent, so the
 * resume path may call it on every tick.
 *
 * Author provenance is inherited from the parent design this child is projected
 * from. When the parent has none, the revision records no agent and readiness
 * reports ARTIFACT_AUTHOR_REQUIRED — the honest outcome. A fabricated author
 * would walk unattributed work through a gate whose whole purpose is
 * attribution.
 */
export async function healDecompositionChildDesignArtifact(
  input: HealChildDesignArtifactInput,
): Promise<boolean> {
  const { child } = input;
  if (!child.designDoc || !child.createdById) return false;

  const { prisma } = await import("@dpf/db");

  const existing = await prisma.buildArtifactRevision.findFirst({
    where: { buildId: child.buildId, field: "designDoc", status: "accepted" },
    select: { id: true },
  });
  if (existing) return false;

  const parent = await prisma.featureBuild.findFirst({
    where: { supersededByEpicId: child.parentEpicId },
    select: { buildId: true },
  });
  const parentRevision = parent
    ? await prisma.buildArtifactRevision.findFirst({
        where: { buildId: parent.buildId, field: "designDoc", status: "accepted" },
        orderBy: [{ revisionNumber: "desc" }, { createdAt: "desc" }],
        select: { savedByAgentId: true },
      })
    : null;

  const result = await saveBuildArtifactRevision({
    buildId: child.buildId,
    field: "designDoc",
    value: child.designDoc,
    savedByUserId: child.createdById,
    savedByAgentId: parentRevision?.savedByAgentId ?? null,
  });

  // A `warning` revision does not satisfy the gate. Report honestly rather than
  // claiming a heal that leaves the build exactly where it was.
  return result.status === "accepted";
}
