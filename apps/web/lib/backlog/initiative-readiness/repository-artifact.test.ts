import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { readRepositoryProviderBlob, resolveRepositoryArtifact } from "./repository-artifact";

const bytes = Buffer.from("canonical plan bytes\n", "utf8");
const locator = {
  kind: "repo-blob-at-commit" as const,
  repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
  commitSha: "a".repeat(40),
  path: "docs/superpowers/plans/test.md",
  providerBlobId: "b".repeat(40),
};

type CapsuleRow = {
  capsuleId: string;
  headBranch: string | null;
  headSha: string | null;
  createdByPrincipalId: string | null;
  activities: Array<{ recordedByAgentId: string | null }>;
};

function capsule(overrides: Partial<CapsuleRow> = {}): CapsuleRow {
  return {
    capsuleId: "WC-TEST0001",
    headBranch: "feat/test",
    headSha: locator.commitSha,
    createdByPrincipalId: "principal-author",
    activities: [{ recordedByAgentId: "agent-author" }],
    ...overrides,
  };
}

function db(options: {
  capsules?: CapsuleRow[];
  emailPrincipalIds?: string[];
  agentAliasValues?: string[];
} = {}) {
  const capsules = options.capsules ?? [capsule()];
  const emailPrincipalIds = options.emailPrincipalIds ?? ["principal-author"];
  const agentAliasValues = options.agentAliasValues ?? ["agent-author"];
  return {
    workroom: {
      findMany: vi.fn(async () => capsules.map((row) => ({
        ...row,
        // The resolver filters candidates itself, so the store returns every
        // live capsule for the subject regardless of head state.
        activities: row.activities.filter((activity) => activity.recordedByAgentId !== null),
      }))),
    },
    principalAlias: {
      findMany: vi.fn(async ({ where }: { where: { aliasType: string } }) => where.aliasType === "email"
        ? emailPrincipalIds.map((principalId) => ({ principalId }))
        : agentAliasValues.map((aliasValue) => ({ aliasValue }))),
    },
    credentialEntry: { findUnique: vi.fn(async () => null) },
    platformDevConfig: {
      findUnique: vi.fn(async () => ({ upstreamRemoteUrl: "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory.git" })),
    },
    scheduledJob: { findUnique: vi.fn(async () => null) },
  };
}

function providerFetch(signOff = "Signed-off-by: Author <author@example.com>") {
  return vi.fn(async (url: string | URL | Request) => String(url).includes("/commits/")
    ? new Response(JSON.stringify({ commit: { message: `docs: canonical\n\n${signOff}` } }), { status: 200 })
    : new Response(JSON.stringify({
      type: "file",
      sha: locator.providerBlobId,
      encoding: "base64",
      content: bytes.toString("base64"),
    }), { status: 200, headers: { "content-type": "application/json" } }));
}

describe("resolveRepositoryArtifact", () => {
  it("reads a bounded exact blob from the configured canonical repository without a local git object", async () => {
    const fetchImpl = providerFetch();
    const result = await readRepositoryProviderBlob({
      repositoryFullName: locator.repositoryFullName,
      commitSha: locator.commitSha,
      path: locator.path,
      expectedBlobId: locator.providerBlobId,
      db: db() as never,
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(result).toEqual({ ok: true, data: bytes });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining(`/contents/docs/superpowers/plans/test.md?ref=${locator.commitSha}`),
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("rejects a provider response whose blob identity or size exceeds the immutable contract", async () => {
    const mismatch = vi.fn(async () => new Response(JSON.stringify({
      type: "file",
      sha: "c".repeat(40),
      size: bytes.length,
      encoding: "base64",
      content: bytes.toString("base64"),
    }), { status: 200 }));
    await expect(readRepositoryProviderBlob({
      repositoryFullName: locator.repositoryFullName,
      commitSha: locator.commitSha,
      path: locator.path,
      expectedBlobId: locator.providerBlobId,
      db: db() as never,
      fetchImpl: mismatch as typeof fetch,
    })).resolves.toMatchObject({ ok: false, code: "IMMUTABLE_BLOB_MISMATCH" });

    const oversized = vi.fn(async () => new Response(JSON.stringify({
      type: "file",
      sha: locator.providerBlobId,
      size: 1_048_577,
      encoding: "base64",
      content: bytes.toString("base64"),
    }), { status: 200 }));
    await expect(readRepositoryProviderBlob({
      repositoryFullName: locator.repositoryFullName,
      commitSha: locator.commitSha,
      path: locator.path,
      expectedBlobId: locator.providerBlobId,
      db: db() as never,
      fetchImpl: oversized as typeof fetch,
    })).resolves.toMatchObject({ ok: false, code: "IMMUTABLE_SOURCE_TOO_LARGE" });
  });

  it("derives bytes and SHA-256 from the exact provider blob bound to one subject capsule", async () => {
    const fetchImpl = providerFetch();

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
        authorEmail: "author@example.com",
      },
    });
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining(`/commits/${locator.commitSha}`), expect.any(Object));
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining(`/contents/docs/superpowers/plans/test.md?ref=${locator.commitSha}`), expect.objectContaining({ cache: "no-store" }));
  });

  // BI-B9403248: the external-session shape — a human principal records every
  // activity, the install's shared git identity signs the commit, and no agent
  // provenance exists. Authorship is evidence about the accountable principal,
  // not about which surface produced the commit (AGENTS.md §12 keystone).
  it("records authorship for an external session with no agent provenance and no email alias", async () => {
    const result = await resolveRepositoryArtifact({
      locator,
      subject: { kind: "backlog-item", id: "BI-TEST" },
      db: db({
        capsules: [capsule({ activities: [] })],
        emailPrincipalIds: [],
        agentAliasValues: [],
      }) as never,
      fetchImpl: providerFetch("Signed-off-by: DPF CI <dpf-ci@users.noreply.github.com>") as typeof fetch,
    });

    expect(result).toMatchObject({
      ok: true,
      artifact: {
        digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        authorPrincipalId: "principal-author",
        authorAgentId: null,
        authorEmail: "dpf-ci@users.noreply.github.com",
      },
    });
  });

  it("treats multi-agent participation as optional context rather than a blocker", async () => {
    const result = await resolveRepositoryArtifact({
      locator,
      subject: { kind: "backlog-item", id: "BI-TEST" },
      db: db({
        capsules: [capsule({ activities: [{ recordedByAgentId: "agent-author" }, { recordedByAgentId: "review-agent" }] })],
      }) as never,
      fetchImpl: providerFetch() as typeof fetch,
    });

    expect(result).toMatchObject({ ok: true, artifact: { authorPrincipalId: "principal-author", authorAgentId: null } });
  });

  it("rejects a commit whose DCO identity belongs to a principal other than the capsule owner", async () => {
    const result = await resolveRepositoryArtifact({
      locator,
      subject: { kind: "backlog-item", id: "BI-TEST" },
      db: db({ emailPrincipalIds: ["principal-someone-else"] }) as never,
      fetchImpl: providerFetch() as typeof fetch,
    });

    expect(result).toMatchObject({ ok: false, code: "ARTIFACT_AUTHOR_REQUIRED" });
    expect(result).not.toBe(true);
    if (!("error" in result)) throw new Error("expected an error result");
    expect(result.error).toContain("author@example.com");
    expect(result.error).toContain("principal-someone-else");
    expect(result.error).toContain("WC-TEST0001");
  });

  it("rejects a DCO identity registered to more than one principal", async () => {
    const result = await resolveRepositoryArtifact({
      locator,
      subject: { kind: "backlog-item", id: "BI-TEST" },
      db: db({ emailPrincipalIds: ["principal-author", "principal-other"] }) as never,
      fetchImpl: providerFetch() as typeof fetch,
    });

    expect(result).toMatchObject({ ok: false, code: "ARTIFACT_AUTHOR_REQUIRED" });
    if (!("error" in result)) throw new Error("expected an error result");
    expect(result.error).toContain("author@example.com");
  });

  it("rejects commit provenance with no single DCO sign-off and names the remedy", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ commit: { message: "docs: unsigned" } }), { status: 200 }));
    const result = await resolveRepositoryArtifact({
      locator,
      subject: { kind: "backlog-item", id: "BI-TEST" },
      db: db() as never,
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(result).toMatchObject({ ok: false, code: "ARTIFACT_AUTHOR_REQUIRED" });
    if (!("error" in result)) throw new Error("expected an error result");
    expect(result.error).toContain("Signed-off-by");
  });

  it("names the stale head and the remedy when no capsule head matches the plan commit", async () => {
    const fetchImpl = vi.fn();
    const result = await resolveRepositoryArtifact({
      locator,
      subject: { kind: "backlog-item", id: "BI-TEST" },
      db: db({ capsules: [capsule({ headSha: "c".repeat(40) })] }) as never,
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(result).toMatchObject({ ok: false, code: "CANONICAL_DESIGN_AMBIGUOUS" });
    if (!("error" in result)) throw new Error("expected an error result");
    expect(result.error).toContain("WC-TEST0001");
    expect(result.error).toContain("c".repeat(40));
    expect(result.error).toContain("adopt_worktree");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("names the unset head when the capsule was claimed but never synced", async () => {
    const result = await resolveRepositoryArtifact({
      locator,
      subject: { kind: "backlog-item", id: "BI-TEST" },
      db: db({ capsules: [capsule({ headSha: null })] }) as never,
      fetchImpl: vi.fn() as typeof fetch,
    });

    expect(result).toMatchObject({ ok: false, code: "CANONICAL_DESIGN_AMBIGUOUS" });
    if (!("error" in result)) throw new Error("expected an error result");
    expect(result.error).toContain("no recorded head");
    expect(result.error).toContain("adopt_worktree");
  });

  it("resolves the artifact author after canonical head synchronization", async () => {
    const row = capsule({ headSha: null });
    const store = db({ capsules: [row] });
    await expect(resolveRepositoryArtifact({
      locator,
      subject: { kind: "backlog-item", id: "BI-TEST" },
      db: store as never,
      fetchImpl: providerFetch() as typeof fetch,
    })).resolves.toMatchObject({ ok: false, code: "CANONICAL_DESIGN_AMBIGUOUS" });

    row.headSha = locator.commitSha;
    await expect(resolveRepositoryArtifact({
      locator,
      subject: { kind: "backlog-item", id: "BI-TEST" },
      db: store as never,
      fetchImpl: providerFetch() as typeof fetch,
    })).resolves.toMatchObject({
      ok: true,
      artifact: { authorPrincipalId: "principal-author", authorAgentId: "agent-author" },
    });
  });

  it("names the competing capsules when two live capsules claim the same head", async () => {
    const fetchImpl = vi.fn();
    const result = await resolveRepositoryArtifact({
      locator,
      subject: { kind: "backlog-item", id: "BI-TEST" },
      db: db({ capsules: [capsule(), capsule({ capsuleId: "WC-TEST0002", headBranch: "feat/other" })] }) as never,
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(result).toMatchObject({ ok: false, code: "CANONICAL_DESIGN_AMBIGUOUS" });
    if (!("error" in result)) throw new Error("expected an error result");
    expect(result.error).toContain("WC-TEST0001");
    expect(result.error).toContain("WC-TEST0002");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a matching capsule that has no accountable principal", async () => {
    const result = await resolveRepositoryArtifact({
      locator,
      subject: { kind: "backlog-item", id: "BI-TEST" },
      db: db({ capsules: [capsule({ createdByPrincipalId: null })] }) as never,
      fetchImpl: providerFetch() as typeof fetch,
    });

    expect(result).toMatchObject({ ok: false, code: "ARTIFACT_AUTHOR_REQUIRED" });
    if (!("error" in result)) throw new Error("expected an error result");
    expect(result.error).toContain("WC-TEST0001");
  });

  it("returns a stable input-required result when the provider request throws", async () => {
    await expect(resolveRepositoryArtifact({
      locator,
      subject: { kind: "backlog-item", id: "BI-TEST" },
      db: db() as never,
      fetchImpl: vi.fn(async () => { throw new Error("network unavailable"); }) as typeof fetch,
    })).resolves.toMatchObject({ ok: false, code: "CANONICAL_DESIGN_REQUIRED" });
  });
});
