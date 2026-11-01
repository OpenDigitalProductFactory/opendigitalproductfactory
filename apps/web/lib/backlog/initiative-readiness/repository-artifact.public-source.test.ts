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

describe("public component source admission", () => {
  it.each(["subject", "room", "branch", "head", "revoked", "unsigned", "private", "traversal", "blob", "provider"])(
    "refuses selected component research after %s without credentials", async drift => {
      const repositoryFullName = "OpenDigitalProductFactory/dpf-workroom";
      const store = db();
      let current = true;
      const fetchImpl = vi.fn(async (url: string | URL | Request) => {
        if (String(url).endsWith("/dpf-workroom")) return new Response(JSON.stringify({
          full_name: repositoryFullName, private: drift === "private", visibility: drift === "private" ? "private" : "public" }));
        if (drift === "provider") return new Response("unavailable", { status: 503 });
        if (drift === "revoked") current = false;
        return providerFetch(drift === "unsigned" ? "" : undefined)(url);
      });
      const result = await resolveRepositoryArtifact({
        locator: { ...locator, repositoryFullName, path: drift === "traversal" ? "../private" : locator.path,
          providerBlobId: drift === "blob" ? "e".repeat(40) : locator.providerBlobId },
        subject: { kind: "backlog-item", id: "BI-TEST" }, db: store as never, fetchImpl: fetchImpl as typeof fetch,
        sourceAdmission: { itemId: drift === "subject" ? "BI-OTHER" : "BI-TEST",
          workroomId: drift === "room" ? "WC-OTHER" : "WC-TEST0001", repositoryFullName,
          branchName: drift === "branch" ? "codex/other" : "feat/test",
          headSha: drift === "head" ? "d".repeat(40) : locator.commitSha, isCurrent: async () => current },
      });
      expect(result.ok).toBe(false);
      expect(store.credentialEntry.findUnique).not.toHaveBeenCalled();
      if (["subject", "room", "branch", "head", "traversal"].includes(drift)) expect(fetchImpl).not.toHaveBeenCalled();
    });
  it("verifies a public component research artifact through its selected room and existing DCO author checks", async () => {
    const repositoryFullName = "OpenDigitalProductFactory/dpf-workroom";
    const store = db({ capsules: [capsule({ headBranch: "codex/component" })] });
    const fetchImpl = vi.fn(async (url: string | URL | Request) => String(url).endsWith("/dpf-workroom")
      ? new Response(JSON.stringify({ full_name: repositoryFullName, private: false, visibility: "public" }), { status: 200 })
      : providerFetch()(url));
    const result = await resolveRepositoryArtifact({ locator: { ...locator, repositoryFullName },
      subject: { kind: "backlog-item", id: "BI-TEST" }, db: store as never, fetchImpl: fetchImpl as typeof fetch,
      sourceAdmission: { itemId: "BI-TEST", workroomId: "WC-TEST0001", repositoryFullName,
        branchName: "codex/component", headSha: locator.commitSha, isCurrent: async () => true },
    } as Parameters<typeof resolveRepositoryArtifact>[0]);
    expect(result).toMatchObject({ ok: true, artifact: { bytes, authorPrincipalId: "principal-author" } });
    expect(store.credentialEntry.findUnique).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining(`/commits/${locator.commitSha}`), expect.anything());
    for (const [, options] of fetchImpl.mock.calls as unknown as Array<[unknown, RequestInit]>) {
      expect(options.headers).not.toHaveProperty("Authorization");
      expect(options.redirect).toBe("error");
    }
  });
  it("reads an exact actor-admitted public component without resolving or forwarding private credentials", async () => {
    const repositoryFullName = "OpenDigitalProductFactory/dpf-workroom";
    const store = db();
    const isCurrent = vi.fn(async () => true);
    const fetchImpl = vi.fn(async (url: string | URL | Request) => String(url).endsWith("/dpf-workroom")
      ? new Response(JSON.stringify({ full_name: repositoryFullName, private: false, visibility: "public" }), { status: 200 })
      : providerFetch()(url));
    const result = await readRepositoryProviderBlob({ repositoryFullName, commitSha: locator.commitSha,
      path: locator.path, expectedBlobId: locator.providerBlobId, db: store as never, fetchImpl: fetchImpl as typeof fetch,
      sourceAdmission: { itemId: "BI-TEST", workroomId: "WC-TEST0001", repositoryFullName,
        branchName: "codex/component", headSha: locator.commitSha, isCurrent },
    } as Parameters<typeof readRepositoryProviderBlob>[0]);
    expect(result).toMatchObject({ ok: true, data: bytes, blobId: locator.providerBlobId });
    expect(store.credentialEntry.findUnique).not.toHaveBeenCalled();
    for (const [, options] of fetchImpl.mock.calls as unknown as Array<[unknown, RequestInit]>) {
      expect(options.headers).not.toHaveProperty("Authorization");
    }
    expect(isCurrent.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it.each(["unbound", "private", "unknown", "foreign-identity", "moved-head", "revoked", "missing-blob"])(
    "refuses component source after %s without reading credentials", async drift => {
      const repositoryFullName = "OpenDigitalProductFactory/dpf-workroom";
      const store = db();
      let current = true;
      const fetchImpl = vi.fn(async (url: string | URL | Request) => {
        if (String(url).endsWith("/dpf-workroom")) return new Response(JSON.stringify({
          full_name: drift === "foreign-identity" ? "foreign/repository" : repositoryFullName,
          private: drift === "private", visibility: drift === "unknown" ? undefined : drift === "private" ? "private" : "public",
        }), { status: 200 });
        if (drift === "revoked") current = false;
        return providerFetch()(url);
      });
      const sourceAdmission = drift === "unbound" ? undefined : { itemId: "BI-TEST", workroomId: "WC-TEST0001",
        repositoryFullName, branchName: "codex/component", headSha: drift === "moved-head" ? "d".repeat(40) : locator.commitSha,
        isCurrent: async () => current };
      const result = await readRepositoryProviderBlob({ repositoryFullName, commitSha: locator.commitSha,
        path: locator.path, expectedBlobId: drift === "missing-blob" ? null : locator.providerBlobId,
        db: store as never, fetchImpl: fetchImpl as typeof fetch, sourceAdmission,
      } as Parameters<typeof readRepositoryProviderBlob>[0]);
      expect(result.ok).toBe(false);
      expect(store.credentialEntry.findUnique).not.toHaveBeenCalled();
    });

});
