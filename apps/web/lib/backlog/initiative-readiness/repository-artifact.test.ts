import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { resolveRepositoryArtifact } from "./repository-artifact";

const bytes = Buffer.from("canonical plan bytes\n", "utf8");
const locator = {
  kind: "repo-blob-at-commit" as const,
  repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
  commitSha: "a".repeat(40),
  path: "docs/superpowers/plans/test.md",
  providerBlobId: "b".repeat(40),
};

function db(capsuleCount = 1) {
  return {
    workCapsule: {
      findMany: vi.fn(async () => Array.from({ length: capsuleCount }, () => ({
        createdByPrincipalId: "principal-author",
        activities: [{ recordedByAgentId: "agent-author" }],
      }))),
    },
    principalAlias: { findFirst: vi.fn(async () => ({ principalId: "principal-author" })) },
    credentialEntry: { findUnique: vi.fn(async () => null) },
    platformDevConfig: {
      findUnique: vi.fn(async () => ({ upstreamRemoteUrl: "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory.git" })),
    },
    scheduledJob: { findUnique: vi.fn(async () => null) },
  };
}

describe("resolveRepositoryArtifact", () => {
  it("derives bytes and SHA-256 from the exact provider blob bound to one subject capsule", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      type: "file",
      sha: locator.providerBlobId,
      encoding: "base64",
      content: bytes.toString("base64"),
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const result = await resolveRepositoryArtifact({
      locator,
      subject: { kind: "backlog-item", id: "BI-TEST" },
      db: db() as never,
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(result).toMatchObject({
      ok: true,
      artifact: {
        digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        authorPrincipalId: "principal-author",
        authorAgentId: "agent-author",
      },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining(`/contents/docs/superpowers/plans/test.md?ref=${locator.commitSha}`),
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("fails closed before provider access when capsule ownership is ambiguous", async () => {
    const fetchImpl = vi.fn();
    await expect(resolveRepositoryArtifact({
      locator,
      subject: { kind: "backlog-item", id: "BI-TEST" },
      db: db(2) as never,
      fetchImpl: fetchImpl as typeof fetch,
    })).resolves.toMatchObject({ ok: false, code: "CANONICAL_DESIGN_AMBIGUOUS" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
