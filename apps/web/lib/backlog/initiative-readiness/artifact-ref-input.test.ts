import { describe, expect, it, vi } from "vitest";

import { normalizeRepositoryArtifactRefInput } from "./artifact-ref-input";

const REPO = "OpenDigitalProductFactory/opendigitalproductfactory";
const HEAD = "7fb295cf3a01e502439c29b858fdcdbe28f4758e";
const BLOB = "b".repeat(40);

function deps(overrides: Partial<Parameters<typeof normalizeRepositoryArtifactRefInput>[1]> = {}) {
  return {
    canonicalRepositoryFullName: vi.fn(async () => REPO),
    commitDeps: vi.fn(() => ({
      lookupProviderCommit: vi.fn(async () => ({ kind: "found" as const, sha: HEAD })),
      recordedCandidates: vi.fn(async () => [] as string[]),
    })),
    readBlobId: vi.fn(async () => ({ ok: true as const, blobId: BLOB })),
    ...overrides,
  };
}

const call = (artifactRef: unknown) => ({ tool: "record_initiative_evidence", args: { itemId: "BI-ONE", gate: "research", decision: "pass", artifactRef } });

describe("normalizeRepositoryArtifactRefInput (BI-DF34D948)", () => {
  it("leaves a complete repository locator untouched without any provider read", async () => {
    const ref = { kind: "repo-blob-at-commit", repositoryFullName: REPO, commitSha: HEAD, path: "docs/a.md", providerBlobId: BLOB };
    const d = deps();
    expect(await normalizeRepositoryArtifactRefInput(ref, d, call(ref))).toEqual({ ok: true, artifactRef: ref, derived: [] });
    expect(d.readBlobId).not.toHaveBeenCalled();
    expect(d.canonicalRepositoryFullName).not.toHaveBeenCalled();
  });

  it("passes non-repository kinds through", async () => {
    const ref = { kind: "document-version", versionId: "DV-1" };
    expect(await normalizeRepositoryArtifactRefInput(ref, deps(), call(ref))).toEqual({ ok: true, artifactRef: ref, derived: [] });
  });

  it("derives kind, repository, full commit and blob id from {path, headSha}", async () => {
    const d = deps();
    const result = await normalizeRepositoryArtifactRefInput({ path: "docs/a.md", headSha: "7fb295c" }, d, call({}));
    expect(result).toEqual({ ok: true,
      artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: REPO, commitSha: HEAD, path: "docs/a.md", providerBlobId: BLOB },
      derived: ["kind", "repositoryFullName", "commitSha", "providerBlobId"] });
    expect(d.readBlobId).toHaveBeenCalledWith({ repositoryFullName: REPO, commitSha: HEAD, path: "docs/a.md" });
  });

  it("refuses a short providerBlobId that the provider blob does not extend", async () => {
    const ref = { kind: "repo-blob-at-commit", path: "docs/a.md", commitSha: HEAD, providerBlobId: "cccccccc" };
    const result = await normalizeRepositoryArtifactRefInput(ref, deps(), call(ref));
    expect(result).toMatchObject({ ok: false, refusal: { success: false, error: "malformed-receipt" } });
    if (result.ok) throw new Error("expected refusal");
    expect(result.refusal.message).toContain(`"providerBlobId":"${BLOB}"`);
  });

  it("names the push remedy and the exact corrected call when the commit is not on the provider", async () => {
    const d = deps({ readBlobId: vi.fn(async () => ({ ok: false as const, code: "IMMUTABLE_SOURCE_UNAVAILABLE", error: "HTTP 404" })) });
    const result = await normalizeRepositoryArtifactRefInput({ path: "docs/a.md", headSha: HEAD }, d, call({ path: "docs/a.md", headSha: HEAD }));
    if (result.ok) throw new Error("expected refusal");
    expect(result.refusal.error).toBe("IMMUTABLE_SOURCE_UNAVAILABLE");
    expect(result.refusal.message).toContain("git push");
    expect(result.refusal.message).toContain(`record_initiative_evidence({"itemId":"BI-ONE","gate":"research","decision":"pass","artifactRef":{"path":"docs/a.md","headSha":"${HEAD}"}})`);
  });

  it("refuses a missing path with a worked example", async () => {
    const result = await normalizeRepositoryArtifactRefInput({ kind: "repo-blob-at-commit", headSha: HEAD }, deps(), call({}));
    if (result.ok) throw new Error("expected refusal");
    expect(result.refusal.message).toContain(`"artifactRef":{"path":"docs/superpowers/specs/<file>.md","headSha":"${HEAD}"}`);
  });

  it("carries the SHA refusal through with the artifactRef corrected", async () => {
    const d = deps({ commitDeps: () => ({ lookupProviderCommit: async () => ({ kind: "not-found" as const }), recordedCandidates: async () => [] }) });
    const result = await normalizeRepositoryArtifactRefInput({ path: "docs/a.md", headSha: "7fb295c" }, d, call({ path: "docs/a.md", headSha: "7fb295c" }));
    if (result.ok) throw new Error("expected refusal");
    expect(result.refusal.message).toContain("git rev-parse 7fb295c");
    expect(result.refusal.message).toContain(`"artifactRef":{"path":"docs/a.md","headSha":"<40-hex output of git rev-parse 7fb295c>"}`);
  });
});
