import { describe, expect, it, vi } from "vitest";

import { resolveInitiativeArtifact, type InitiativeArtifactResolverDb } from "./initiative-readiness";

describe("resolveInitiativeArtifact", () => {
  it("uses the stored BuildArtifactRevision digest and author for the matching subject", async () => {
    const db: InitiativeArtifactResolverDb = {
      buildArtifactRevision: { findUnique: vi.fn(async () => ({
        id: "rev-1",
        valueDigest: "server",
        value: "**OBJ-TEST-001:** Preserve scope.\n| AC-TEST-001 | OBJ-TEST-001 | Scope is preserved. | test |",
        field: "designDoc",
        status: "accepted",
        savedByUserId: "principal-author",
        savedByAgentId: "agent-author",
        build: { originatingBacklogItemId: "backlog-row-1", abandonedAt: null },
      })) },
      documentVersion: { findUnique: vi.fn() },
      principalAlias: { findMany: vi.fn(async () => [{ principal: { principalId: "principal-author" } }]) },
    };
    await expect(resolveInitiativeArtifact({
      locator: { kind: "feature-build-revision", revisionId: "rev-1" },
      subject: { kind: "backlog-item", id: "backlog-row-1" },
      db,
    })).resolves.toMatchObject({ ok: true, artifact: { digest: "sha256:server", authorPrincipalId: "principal-author", authorAgentId: "agent-author" } });
  });

  it("fails closed for unrelated builds and incomplete author provenance", async () => {
    const db: InitiativeArtifactResolverDb = {
      buildArtifactRevision: { findUnique: vi.fn(async () => ({
        id: "rev-1",
        valueDigest: "server",
        value: "**OBJ-TEST-001:** Preserve scope.\n| AC-TEST-001 | OBJ-TEST-001 | Scope is preserved. | test |",
        field: "designDoc",
        status: "accepted",
        savedByUserId: "principal-author",
        savedByAgentId: null,
        build: { originatingBacklogItemId: "other", abandonedAt: null },
      })) },
      documentVersion: { findUnique: vi.fn() },
      principalAlias: { findMany: vi.fn(async () => [{ principal: { principalId: "principal-author" } }]) },
    };
    await expect(resolveInitiativeArtifact({
      locator: { kind: "feature-build-revision", revisionId: "rev-1" },
      subject: { kind: "backlog-item", id: "backlog-row-1" },
      db,
    })).resolves.toMatchObject({ ok: false, code: "ARTIFACT_AUTHOR_REQUIRED" });
  });

  it("fails closed when the author alias maps to more than one principal", async () => {
    const db: InitiativeArtifactResolverDb = {
      buildArtifactRevision: { findUnique: vi.fn(async () => ({
        id: "rev-1",
        valueDigest: "server",
        value: "**OBJ-TEST-001:** Preserve scope.\n| AC-TEST-001 | OBJ-TEST-001 | Scope is preserved. | test |",
        field: "designDoc",
        status: "accepted",
        savedByUserId: "ambiguous-user",
        savedByAgentId: "agent-author",
        build: { originatingBacklogItemId: "backlog-row-1", abandonedAt: null },
      })) },
      documentVersion: { findUnique: vi.fn() },
      principalAlias: { findMany: vi.fn(async () => [
        { principal: { principalId: "principal-one" } },
        { principal: { principalId: "principal-two" } },
      ]) },
    };
    await expect(resolveInitiativeArtifact({
      locator: { kind: "feature-build-revision", revisionId: "rev-1" },
      subject: { kind: "backlog-item", id: "backlog-row-1" },
      db,
    })).resolves.toMatchObject({ ok: false, code: "ARTIFACT_AUTHOR_REQUIRED" });
  });

  it("normalizes a repository provider exception to a stable readiness result", async () => {
    await expect(resolveInitiativeArtifact({
      locator: {
        kind: "repo-blob-at-commit",
        repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
        commitSha: "a".repeat(40),
        path: "docs/superpowers/specs/test.md",
        providerBlobId: "b".repeat(40),
      },
      subject: { kind: "backlog-item", id: "BI-TEST" },
      resolveRepositoryBlob: vi.fn(async () => { throw new Error("provider unavailable"); }),
    })).resolves.toMatchObject({ ok: false, code: "CANONICAL_DESIGN_REQUIRED" });
  });
});
