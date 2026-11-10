import { describe, expect, it, vi } from "vitest";
import { loadCanonicalPlanSource, sameCanonicalPlanSource } from "./canonical-plan-source";
import { item, readyActivities } from "./entry-adapter.test-fixtures";
import type { InitiativeReadinessActivity } from "./entry-adapter";

const artifactRef = { kind: "repo-blob-at-commit" as const, repositoryFullName: "owner/repo",
  commitSha: "a".repeat(40), providerBlobId: "b".repeat(40), path: "docs/superpowers/plans/plan.md" };
const digest = `sha256:${"d".repeat(64)}`;

function fixture(inherited = false) {
  const activities: Array<InitiativeReadinessActivity & { payload: Record<string, unknown> }> = readyActivities();
  const coverage = activities.find((row) => row.kind === "plan_backlog_coverage")!;
  coverage.payload = { ...coverage.payload, planArtifactRef: artifactRef, planArtifactDigest: digest,
    ...(inherited ? { decision: "decomposed", deliverables: [{ backlogItemId: "BI-CHILD" }] } : {}) } as typeof coverage.payload;
  const db = {
    backlogItem: { findUnique: vi.fn(async () => ({ ...item, itemId: inherited ? "BI-CHILD" : item.itemId,
      activeBuild: null, activities: inherited ? [] : activities })), findFirst: vi.fn(async () => ({ itemId: item.itemId })) },
    backlogItemActivity: { findMany: vi.fn(async (args: { where: { payload?: unknown } }) => args.where.payload
      ? inherited ? [{ id: coverage.id, backlogItemId: item.id, payload: coverage.payload }] : [] : activities) },
  };
  return { db, coverage, activities };
}

describe("current canonical plan source", () => {
  it.each([false, true])("reuses the actual baseline/coverage projection with inherited=%s", async (inherited) => {
    const f = fixture(inherited);
    expect(await loadCanonicalPlanSource({ itemId: inherited ? "BI-CHILD" : item.itemId,
      repositoryFullName: "owner/repo", db: f.db as never })).toEqual({
      itemId: inherited ? "BI-CHILD" : item.itemId, baselineId: "baseline-1", scopeOwnerItemId: item.itemId, artifactRef, digest,
    });
  });

  it.each(["missing", "repository", "stale-baseline", "bad-digest", "changed-locator", "removed-child"])(
    "refuses unusable canonical coverage: %s", async (drift) => {
      const f = fixture(drift === "removed-child");
      if (drift === "missing") f.db.backlogItem.findUnique.mockResolvedValue(null as never);
      if (drift === "stale-baseline") f.coverage.payload = { ...f.coverage.payload, scopeBaselineId: "baseline-old" };
      if (drift === "bad-digest") f.coverage.payload = { ...f.coverage.payload, planArtifactDigest: "invalid" };
      if (drift === "changed-locator") f.coverage.payload = { ...f.coverage.payload, planArtifactRef: { ...artifactRef, providerBlobId: "invalid" } };
      if (drift === "removed-child") f.activities.push({ ...f.coverage, id: "coverage-new", recordedAt: new Date(Date.now() + 60_000),
        payload: { ...f.coverage.payload, deliverables: [] } });
      expect(await loadCanonicalPlanSource({ itemId: drift === "removed-child" ? "BI-CHILD" : item.itemId,
        repositoryFullName: drift === "repository" ? "foreign/repo" : "owner/repo", db: f.db as never })).toBeNull();
    });

  it("compares every canonical source identity field without normalizing plan bytes", () => {
    const proof = { itemId: item.itemId, baselineId: "baseline-1", scopeOwnerItemId: item.itemId, artifactRef, digest };
    expect(sameCanonicalPlanSource(proof, structuredClone(proof))).toBe(true);
    for (const field of ["itemId", "baselineId", "scopeOwnerItemId", "digest"] as const)
      expect(sameCanonicalPlanSource(proof, { ...proof, [field]: "changed" })).toBe(false);
    for (const field of ["repositoryFullName", "path", "commitSha", "providerBlobId"] as const)
      expect(sameCanonicalPlanSource(proof, { ...proof, artifactRef: { ...artifactRef, [field]: "changed" } })).toBe(false);
  });
});
