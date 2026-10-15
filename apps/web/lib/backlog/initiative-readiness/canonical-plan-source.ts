import { prisma } from "@dpf/db";
import type { InitiativeRecoveryCanonicalArtifact } from "@/lib/tak/initiative-readiness-tool-grants";
import type { InitiativeArtifactRef } from "./receipt-schema";
import { projectBacklogItemReadiness } from "./entry-adapter";
import { coverageMapsChild, loadInheritedInitiativeScope } from "./parent-scope-inheritance";

export type CanonicalPlanSourceProof = {
  itemId: string;
  baselineId: string;
  scopeOwnerItemId: string;
  artifactRef: Extract<InitiativeArtifactRef, { kind: "repo-blob-at-commit" }>;
  digest: string;
};

/** The same current, baseline-validated coverage used to issue plan review. */
export async function loadCanonicalPlanSource(args: {
  itemId: string;
  repositoryFullName: string;
  db?: Pick<typeof prisma, "backlogItem" | "backlogItemActivity">;
}): Promise<CanonicalPlanSourceProof | null> {
  const db = args.db ?? prisma;
  const item = await db.backlogItem.findUnique({ where: { itemId: args.itemId },
    include: { activeBuild: { select: { kind: true } }, activities: { orderBy: [{ recordedAt: "asc" }, { id: "asc" }] } } });
  if (!item) return null;
  const inheritedScope = await loadInheritedInitiativeScope(db, { childItemId: item.itemId, childRowId: item.id });
  const projected = projectBacklogItemReadiness({
    item: { ...item, activeBuildKind: item.activeBuild?.kind ?? null }, activities: item.activities, inheritedScope,
    target: "implementation", transitionObject: { kind: "backlog-item", id: item.itemId,
      expectedVersion: "read-projection", targetState: "implementation" },
    authorization: "pass", capsuleIdentity: "pass", evaluatedAt: new Date().toISOString(),
  });
  if (projected.inheritedFrom && inheritedScope) {
    const latest = [...inheritedScope.activities].filter((row) => row.kind === "plan_backlog_coverage")
      .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime() || b.id.localeCompare(a.id))[0];
    // An older mapping is not authority after the parent's current coverage
    // removes this child. Do not silently borrow another deliverable's plan.
    if (!latest || latest.id !== inheritedScope.coverageActivityId || !coverageMapsChild(latest.payload, item.itemId)) return null;
  }
  if (!projected.baselineId || !projected.planArtifact
    || !projected.planArtifactDigest || !/^sha256:[a-f0-9]{64}$/i.test(projected.planArtifactDigest)
    || projected.planArtifact.repositoryFullName.toLowerCase() !== args.repositoryFullName.toLowerCase()) return null;
  return { itemId: item.itemId, baselineId: projected.baselineId,
    scopeOwnerItemId: projected.inheritedFrom ?? item.itemId,
    artifactRef: projected.planArtifact, digest: projected.planArtifactDigest };
}

export function canonicalPlanMatchesArtifact(proof: CanonicalPlanSourceProof, artifact: InitiativeArtifactRef): boolean {
  return artifact.kind === "repo-blob-at-commit" && proof.artifactRef.kind === artifact.kind
    && proof.artifactRef.repositoryFullName === artifact.repositoryFullName && proof.artifactRef.path === artifact.path
    && proof.artifactRef.commitSha === artifact.commitSha && proof.artifactRef.providerBlobId === artifact.providerBlobId;
}

export function sameCanonicalPlanSource(a: CanonicalPlanSourceProof, b: CanonicalPlanSourceProof): boolean {
  return a.itemId === b.itemId && a.baselineId === b.baselineId && a.scopeOwnerItemId === b.scopeOwnerItemId
    && a.digest === b.digest && canonicalPlanMatchesArtifact(a, b.artifactRef);
}

export async function loadPlanReviewArtifact(args: {
  itemId: string;
  repositoryFullName: string;
}): Promise<InitiativeRecoveryCanonicalArtifact> {
  const source = await loadCanonicalPlanSource(args);
  return source ? { resolved: true, path: source.artifactRef.path, commitSha: source.artifactRef.commitSha,
    providerBlobId: source.artifactRef.providerBlobId } : { resolved: false,
    nextAction: "Record valid plan coverage for the current baseline and this Workroom repository, including the immutable plan commit and blob, then retry plan review." };
}
