// BI-BB919901 — resolving what a release actually publishes.
//
// Every failure mode has to converge on null rather than throwing, because an
// air-gapped install is a SUPPORTED topology. A portal that cannot reach GitHub
// must still issue a bootstrap token and render the container command; it just
// cannot offer the native download.

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  parseReleaseAssets,
  resetNativeReleaseAssetsCache,
  resolveNativeReleaseAssets,
} from "./native-release-assets";

const OK_BODY = {
  tag_name: "v2026.08.25-consumer-self-upgrade.2",
  assets: [
    { name: "dpf-edge-node-darwin-arm64" },
    { name: "dpf-edge-node-windows-amd64.exe" },
    { name: "dpf-edge-node-checksums.sha256" },
  ],
};

const okResponse = (body: unknown) =>
  ({ ok: true, json: async () => body }) as unknown as Response;

beforeEach(() => {
  resetNativeReleaseAssetsCache();
});

describe("parseReleaseAssets", () => {
  it("reads the tag and every asset name", () => {
    const parsed = parseReleaseAssets(OK_BODY, "owner/repo");
    expect(parsed).toEqual({
      tag: "v2026.08.25-consumer-self-upgrade.2",
      assetNames: [
        "dpf-edge-node-darwin-arm64",
        "dpf-edge-node-windows-amd64.exe",
        "dpf-edge-node-checksums.sha256",
      ],
      repoSlug: "owner/repo",
    });
  });

  it("returns null for a body that is not a release", () => {
    for (const body of [null, undefined, "string", 42, [], {}]) {
      expect(parseReleaseAssets(body, "owner/repo")).toBeNull();
    }
  });

  it("returns null when the tag is missing or blank", () => {
    expect(parseReleaseAssets({ ...OK_BODY, tag_name: "" }, "owner/repo")).toBeNull();
    expect(parseReleaseAssets({ assets: [] }, "owner/repo")).toBeNull();
  });

  it("returns an empty asset list rather than null for a source-only release", () => {
    // publish-release.yml attaches binaries in an `if` and warns on failure, so
    // a release with NO edge assets is a real, expected state.
    const parsed = parseReleaseAssets({ ...OK_BODY, assets: [] }, "owner/repo");
    expect(parsed?.assetNames).toEqual([]);
  });

  it("skips malformed asset entries instead of failing the whole read", () => {
    const parsed = parseReleaseAssets(
      { ...OK_BODY, assets: [{ name: "good" }, null, { }, { name: 7 }, "nope"] },
      "owner/repo",
    );
    expect(parsed?.assetNames).toEqual(["good"]);
  });
});

describe("resolveNativeReleaseAssets", () => {
  it("returns the parsed release on success", async () => {
    const fetchImpl = vi.fn(async () => okResponse(OK_BODY));
    const result = await resolveNativeReleaseAssets({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      skipCache: true,
    });
    expect(result?.tag).toBe("v2026.08.25-consumer-self-upgrade.2");
    expect(result?.assetNames).toContain("dpf-edge-node-darwin-arm64");
  });

  it("returns null when GitHub is unreachable — an air-gapped install is supported", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ENOTFOUND api.github.com");
    });
    await expect(
      resolveNativeReleaseAssets({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        skipCache: true,
      }),
    ).resolves.toBeNull();
  });

  it("returns null on a non-OK response, such as a rate limit", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 403 }) as unknown as Response);
    await expect(
      resolveNativeReleaseAssets({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        skipCache: true,
      }),
    ).resolves.toBeNull();
  });

  it("returns null when the body is not JSON", async () => {
    const fetchImpl = vi.fn(
      async () =>
        ({
          ok: true,
          json: async () => {
            throw new Error("invalid json");
          },
        }) as unknown as Response,
    );
    await expect(
      resolveNativeReleaseAssets({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        skipCache: true,
      }),
    ).resolves.toBeNull();
  });

  it("never throws, whatever the failure", async () => {
    for (const impl of [
      async () => {
        throw new Error("boom");
      },
      async () => ({ ok: false }) as unknown as Response,
      async () => ({ ok: true, json: async () => null }) as unknown as Response,
    ]) {
      await expect(
        resolveNativeReleaseAssets({
          fetchImpl: impl as unknown as typeof fetch,
          skipCache: true,
        }),
      ).resolves.not.toThrow();
    }
  });

  it("caches, so opening the provisioning panel does not hammer the API", async () => {
    const fetchImpl = vi.fn(async () => okResponse(OK_BODY));
    const now = () => 1_000;
    await resolveNativeReleaseAssets({ fetchImpl: fetchImpl as unknown as typeof fetch, now });
    await resolveNativeReleaseAssets({ fetchImpl: fetchImpl as unknown as typeof fetch, now });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("re-resolves once the cache expires, so a new release becomes offerable", async () => {
    const fetchImpl = vi.fn(async () => okResponse(OK_BODY));
    await resolveNativeReleaseAssets({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => 0,
    });
    await resolveNativeReleaseAssets({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => 11 * 60 * 1000,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("caches a null too, so an offline install does not retry on every render", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    });
    const now = () => 5_000;
    await resolveNativeReleaseAssets({ fetchImpl: fetchImpl as unknown as typeof fetch, now });
    await resolveNativeReleaseAssets({ fetchImpl: fetchImpl as unknown as typeof fetch, now });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
