import { describe, expect, it, vi } from "vitest";

import { discoverCanonicalDesignArtifact, discoverCanonicalReviewArtifact } from "./canonical-artifact-discovery";

const BASE_SHA = "1111111111111111111111111111111111111111";
const HEAD_SHA = "2222222222222222222222222222222222222222";
const BLOB_SHA = "9f2c1d4e6b8a0c2e4f6a8b0c2d4e6f8a0b2c4d6e";
const OTHER_BLOB_SHA = "0a1b2c3d4e5f60718293a4b5c6d7e8f900112233";

const db = {
  credentialEntry: { findUnique: vi.fn().mockResolvedValue(null) },
  platformDevConfig: { findUnique: vi.fn().mockResolvedValue({ upstreamRemoteUrl: null }) },
} as unknown as Parameters<typeof discoverCanonicalDesignArtifact>[0]["db"];

function compareResponse(files: unknown) {
  return {
    ok: true,
    json: async () => ({ files }),
  } as unknown as Response;
}

function args(fetchImpl: typeof fetch) {
  return {
    repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
    baseSha: BASE_SHA,
    headSha: HEAD_SHA,
    db,
    fetchImpl,
  };
}

describe("canonical design artifact discovery", () => {
  it.each([
    [".github/workflows/stuck-auto-merge-alarm.yml"],
    [".github/workflows/ci.yml", "scripts/ci-evidence-plan.test.mjs", "docs/architecture/build-gate-runbook.md"],
    ["apps/web/lib/repair.test.ts"],
  ])("binds a source-only PIR to its unique repair artifact (%j)", async (...paths) => {
    const fetchImpl = vi.fn().mockResolvedValue(compareResponse(paths.map((filename) => ({ filename, sha: BLOB_SHA, status: "modified" }))));
    const result = await discoverCanonicalReviewArtifact({ ...args(fetchImpl as unknown as typeof fetch), purpose: "post-implementation-review" });
    expect(result).toEqual({ resolved: true, artifact: { path: paths[0], providerBlobId: BLOB_SHA } });
  });

  it("does not turn a source-only repair into a design approval artifact", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(compareResponse([{ filename: ".github/workflows/ci.yml", sha: BLOB_SHA, status: "modified" }]));
    expect(await discoverCanonicalDesignArtifact(args(fetchImpl as unknown as typeof fetch)))
      .toMatchObject({ resolved: false, code: "no-canonical-design" });
  });

  it("retains a unique changed design as the PIR artifact for a multi-file repair", async () => {
    const path = "docs/superpowers/specs/repair.md";
    const fetchImpl = vi.fn().mockResolvedValue(compareResponse([path, "apps/web/lib/a.ts", "apps/web/lib/b.ts"].map((filename) => ({ filename, sha: BLOB_SHA, status: "modified" }))));
    expect(await discoverCanonicalReviewArtifact({ ...args(fetchImpl as unknown as typeof fetch), purpose: "post-implementation-review" }))
      .toEqual({ resolved: true, artifact: { path, providerBlobId: BLOB_SHA } });
  });

  it("refuses ambiguous implementation files rather than arbitrarily choosing one for PIR", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(compareResponse(["apps/web/lib/a.ts", "apps/web/lib/b.ts"].map((filename) => ({ filename, sha: BLOB_SHA, status: "modified" }))));
    expect(await discoverCanonicalReviewArtifact({ ...args(fetchImpl as unknown as typeof fetch), purpose: "post-implementation-review" }))
      .toMatchObject({ resolved: false, code: "ambiguous-repair-artifact" });
  });

  it("does not hide a second implementation artifact because it was deleted", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(compareResponse([
      { filename: "apps/web/lib/a.ts", sha: BLOB_SHA, status: "modified" },
      { filename: "apps/web/lib/b.ts", sha: OTHER_BLOB_SHA, status: "removed" },
    ]));
    expect(await discoverCanonicalReviewArtifact({ ...args(fetchImpl as unknown as typeof fetch), purpose: "post-implementation-review" }))
      .toMatchObject({ resolved: false, code: "ambiguous-repair-artifact" });
  });

  it("does not infer uniqueness after silently dropping malformed provider entries", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(compareResponse([
      { filename: "apps/web/lib/a.ts", sha: BLOB_SHA, status: "modified" }, null,
    ]));
    expect(await discoverCanonicalReviewArtifact({ ...args(fetchImpl as unknown as typeof fetch), purpose: "post-implementation-review" }))
      .toMatchObject({ resolved: false, code: "provider-unavailable" });
  });

  it("does not infer unique repair scope from a provider-capped comparison", async () => {
    const files = Array.from({ length: 300 }, (_, index) => ({ filename: index === 0 ? "apps/web/lib/a.ts" : `docs/${index}.md`, sha: BLOB_SHA, status: "modified" }));
    const fetchImpl = vi.fn().mockResolvedValue(compareResponse(files));
    expect(await discoverCanonicalReviewArtifact({ ...args(fetchImpl as unknown as typeof fetch), purpose: "post-implementation-review" }))
      .toMatchObject({ resolved: false, code: "provider-unavailable" });
  });

  it.each([
    { filename: ".github/workflows/ci.yml", sha: BLOB_SHA, status: "removed" },
    { filename: "../outside.ts", sha: BLOB_SHA, status: "modified" },
    { filename: "apps/web/lib/a.ts", sha: "invalid", status: "modified" },
  ])("refuses absent or invalid repair bytes (%j)", async (file) => {
    const fetchImpl = vi.fn().mockResolvedValue(compareResponse([file]));
    expect(await discoverCanonicalReviewArtifact({ ...args(fetchImpl as unknown as typeof fetch), purpose: "post-implementation-review" }))
      .toMatchObject({ resolved: false, code: "no-repair-artifact" });
  });

  it("reuses the explicitly referenced unchanged design at the immutable head", async () => {
    const path = "docs/superpowers/specs/2026-09-03-coordinated-workrooms-design.md";
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true,
      json: async () => ({ type: "file", path, sha: BLOB_SHA }),
    } as Response);
    const result = await discoverCanonicalDesignArtifact({
      ...args(fetchImpl as unknown as typeof fetch),
      backlogBody: `## Design\n\`${path}\` and Phase D of the existing plan.`,
    });
    expect(result).toEqual({ resolved: true, artifact: { path, providerBlobId: BLOB_SHA } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(`/contents/${path}?ref=${HEAD_SHA}`);
  });

  it("refuses multiple explicitly referenced designs without selecting a changed file", async () => {
    const fetchImpl = vi.fn();
    const result = await discoverCanonicalDesignArtifact({
      ...args(fetchImpl as unknown as typeof fetch),
      backlogBody: "`docs/superpowers/specs/a.md` and `docs/superpowers/specs/b.md`",
    });
    expect(result).toMatchObject({ resolved: false, code: "ambiguous-canonical-design" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses traversal in an explicit design reference before provider access", async () => {
    const fetchImpl = vi.fn();
    const result = await discoverCanonicalDesignArtifact({
      ...args(fetchImpl as unknown as typeof fetch),
      backlogBody: "`docs/superpowers/specs/../../private.md`",
    });
    expect(result).toMatchObject({ resolved: false, code: "no-canonical-design" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("deduplicates Markdown links and section references to the same design", async () => {
    const path = "docs/superpowers/specs/a.md";
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true,
      json: async () => ({ type: "file", path, sha: BLOB_SHA }),
    } as Response);
    const result = await discoverCanonicalDesignArtifact({
      ...args(fetchImpl as unknown as typeof fetch),
      backlogBody: `[Design](${path}#scope) and \`${path}\``,
    });
    expect(result).toMatchObject({ resolved: true, artifact: { path } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not replace a missing explicit design with an unrelated changed spec", async () => {
    const cancel = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404, body: { cancel } } as unknown as Response);
    const result = await discoverCanonicalDesignArtifact({
      ...args(fetchImpl as unknown as typeof fetch), backlogBody: "`docs/superpowers/specs/missing.md`",
    });
    expect(result).toMatchObject({ resolved: false, code: "provider-unavailable" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each([
    { type: "dir", path: "docs/superpowers/specs/a.md", sha: BLOB_SHA },
    { type: "file", path: "docs/superpowers/specs/other.md", sha: BLOB_SHA },
    { type: "file", path: "docs/superpowers/specs/a.md", sha: "invalid" },
  ])("refuses unverifiable explicit content without falling back to compare (%j)", async (content) => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => content } as Response);
    const result = await discoverCanonicalDesignArtifact({
      ...args(fetchImpl as unknown as typeof fetch), backlogBody: "`docs/superpowers/specs/a.md`",
    });
    expect(result).toMatchObject({ resolved: false, code: "provider-unavailable" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("uses and closes the isolated production transport when no fetch is injected", async () => {
    const frameworkFetch = vi.fn().mockRejectedValue(new Error("framework context unavailable"));
    vi.stubGlobal("fetch", frameworkFetch);
    const isolatedFetch = vi.fn().mockResolvedValue(compareResponse([
      { filename: "docs/superpowers/specs/2026-08-25-a-design.md", sha: BLOB_SHA, status: "added" },
    ]));
    const close = vi.fn().mockResolvedValue(undefined);

    try {
      const result = await discoverCanonicalDesignArtifact({
        repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
        baseSha: BASE_SHA,
        headSha: HEAD_SHA,
        db,
        transportFactory: () => ({ fetch: isolatedFetch as unknown as typeof fetch, close }),
      } as never);

      expect(result).toMatchObject({ resolved: true, artifact: { providerBlobId: BLOB_SHA } });
      expect(isolatedFetch).toHaveBeenCalledTimes(1);
      expect(frameworkFetch).not.toHaveBeenCalled();
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("maps production transport construction failure to provider-unavailable", async () => {
    const result = await discoverCanonicalDesignArtifact({
      repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      db,
      transportFactory: () => {
        throw new Error("dispatcher unavailable");
      },
    });

    expect(result).toMatchObject({ resolved: false, code: "provider-unavailable" });
  });

  it("binds the single spec changed across the branch range, taking the blob id from the provider", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(compareResponse([
      { filename: "apps/web/lib/thing.ts", sha: OTHER_BLOB_SHA, status: "modified" },
      { filename: "docs/superpowers/specs/2026-08-25-a-design.md", sha: BLOB_SHA, status: "added" },
    ]));

    const result = await discoverCanonicalDesignArtifact(args(fetchImpl as unknown as typeof fetch));

    expect(result).toEqual({
      resolved: true,
      artifact: { path: "docs/superpowers/specs/2026-08-25-a-design.md", providerBlobId: BLOB_SHA },
    });
    // The compare RANGE, not the head commit: a design authored across several
    // commits would be invisible to `GET /commits/{sha}`.
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(`compare/${BASE_SHA}...${HEAD_SHA}`);
  });

  it("reports no canonical design when the branch changed no spec", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(compareResponse([
      { filename: "apps/web/lib/thing.ts", sha: OTHER_BLOB_SHA, status: "modified" },
    ]));

    const result = await discoverCanonicalDesignArtifact(args(fetchImpl as unknown as typeof fetch));

    expect(result).toMatchObject({ resolved: false, code: "no-canonical-design" });
    expect(result.resolved === false && result.nextAction).toContain("docs/superpowers/specs/");
  });

  it("refuses to choose when more than one spec changed, and names the candidates", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(compareResponse([
      { filename: "docs/superpowers/specs/2026-08-25-a-design.md", sha: BLOB_SHA, status: "added" },
      { filename: "docs/superpowers/specs/2026-08-25-b-design.md", sha: OTHER_BLOB_SHA, status: "added" },
    ]));

    const result = await discoverCanonicalDesignArtifact(args(fetchImpl as unknown as typeof fetch));

    expect(result).toMatchObject({ resolved: false, code: "ambiguous-canonical-design" });
    expect(result.resolved === false && result.nextAction).toContain("2026-08-25-b-design.md");
  });

  it("ignores a spec the branch deleted", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(compareResponse([
      { filename: "docs/superpowers/specs/2026-08-25-a-design.md", sha: BLOB_SHA, status: "added" },
      { filename: "docs/superpowers/specs/2026-01-01-old-design.md", sha: OTHER_BLOB_SHA, status: "removed" },
    ]));

    const result = await discoverCanonicalDesignArtifact(args(fetchImpl as unknown as typeof fetch));

    expect(result).toMatchObject({ resolved: true, artifact: { providerBlobId: BLOB_SHA } });
  });

  it.each(["baseSha", "headSha"] as const)("names %s and supplies both identity fields in adoption repair", async (field) => {
    const fetchImpl = vi.fn();

    const result = await discoverCanonicalDesignArtifact({
      ...args(fetchImpl as unknown as typeof fetch),
      [field]: "",
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toMatchObject({ resolved: false, code: "provider-unavailable" });
    expect(result.resolved === false && result.nextAction).toContain("adopt_worktree");
    expect(result.resolved === false && result.nextAction).toContain(field);
    expect(result.resolved === false && result.nextAction).toContain("adopt_worktree(headBranch, baseSha, headSha)");
  });

  it("reports provider unavailability rather than guessing when the compare fails", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      body: { cancel },
    } as unknown as Response);

    const result = await discoverCanonicalDesignArtifact(args(fetchImpl as unknown as typeof fetch));

    expect(result).toMatchObject({ resolved: false, code: "provider-unavailable" });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
