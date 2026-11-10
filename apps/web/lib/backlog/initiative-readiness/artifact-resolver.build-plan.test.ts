// BI-6F2872FC — a plan review binds the build's current accepted plan revision.
import { describe, expect, it, vi } from "vitest";

import { resolveInitiativeArtifact, type InitiativeArtifactResolverDb } from "./artifact-resolver";

const planValue = { tasks: [{ title: "Add it", testFirst: "t", implement: "i", verify: "v", satisfies: ["AC-1"] }] };

function db(overrides: Record<string, unknown> = {}): InitiativeArtifactResolverDb {
  return {
    buildArtifactRevision: { findUnique: vi.fn(async () => ({
      id: "rev-plan",
      valueDigest: "plan",
      value: planValue,
      field: "buildPlan",
      status: "accepted",
      savedByUserId: "user-author",
      savedByAgentId: "AGT-WS-BUILD",
      build: {
        buildId: "FB-1",
        originatingBacklogItemId: "backlog-row-1",
        abandonedAt: null,
        artifactRevisions: [{ id: "rev-plan", field: "buildPlan" }, { id: "rev-design", field: "designDoc" }],
      },
      ...overrides,
    })) },
    documentVersion: { findUnique: vi.fn() },
    principalAlias: { findMany: vi.fn(async () => [{ principal: { principalId: "principal-author" } }]) },
  } as unknown as InitiativeArtifactResolverDb;
}

const base = {
  locator: { kind: "feature-build-revision" as const, revisionId: "rev-plan" },
  subject: { kind: "backlog-item" as const, id: "backlog-row-1" },
};

describe("resolveInitiativeArtifact for a Build Studio plan revision", () => {
  it("resolves the current accepted plan for a plan review, as reviewable plan text", async () => {
    const resolved = await resolveInitiativeArtifact({ ...base, db: db(), acceptBuildPlan: true });
    expect(resolved).toMatchObject({ ok: true, artifact: { digest: "sha256:plan", authorAgentId: "AGT-WS-BUILD" } });
    if (resolved.ok) expect(Buffer.from(resolved.artifact.bytes).toString("utf8")).toContain("Satisfies: AC-1");
  });

  it("never lets a plan stand in for the design", async () => {
    await expect(resolveInitiativeArtifact({ ...base, db: db() })).resolves.toMatchObject({ ok: false, code: "CANONICAL_DESIGN_REQUIRED" });
  });

  it("refuses a plan revision that is no longer the current accepted plan", async () => {
    const stale = db({ build: { buildId: "FB-1", originatingBacklogItemId: "backlog-row-1", abandonedAt: null,
      artifactRevisions: [{ id: "rev-plan-2", field: "buildPlan" }, { id: "rev-plan", field: "buildPlan" }] } });
    await expect(resolveInitiativeArtifact({ ...base, db: stale, acceptBuildPlan: true }))
      .resolves.toMatchObject({ ok: false, code: "CANONICAL_DESIGN_AMBIGUOUS" });
  });

  it("still refuses a plan whose author agent is unknown", async () => {
    await expect(resolveInitiativeArtifact({ ...base, db: db({ savedByAgentId: null }), acceptBuildPlan: true }))
      .resolves.toMatchObject({ ok: false, code: "ARTIFACT_AUTHOR_REQUIRED" });
  });
});
