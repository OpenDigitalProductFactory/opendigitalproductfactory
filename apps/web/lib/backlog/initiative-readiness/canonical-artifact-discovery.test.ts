import { describe, expect, it, vi } from "vitest";

import { discoverCanonicalDesignArtifact } from "./canonical-artifact-discovery";

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

  it("does not call the provider when the workroom records no immutable base", async () => {
    const fetchImpl = vi.fn();

    const result = await discoverCanonicalDesignArtifact({
      ...args(fetchImpl as unknown as typeof fetch),
      baseSha: "",
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toMatchObject({ resolved: false, code: "provider-unavailable" });
    expect(result.resolved === false && result.nextAction).toContain("adopt_worktree");
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
