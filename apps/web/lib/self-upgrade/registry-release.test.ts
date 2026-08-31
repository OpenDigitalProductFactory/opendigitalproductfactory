import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readRegistryReleaseCandidate } from "./registry-release";

const OWNER = "opendigitalproductfactory";
const REPO = `${OWNER}/dpf-portal`;
const SOURCE_SHA = "b".repeat(40);

function digest(body: string): string {
  return `sha256:${createHash("sha256").update(body).digest("hex")}`;
}

function fixtureFetch(options: {
  version?: string;
  revision?: string;
  immutableTags?: string[];
  tamperChannelDigest?: boolean;
  duplicatePlatform?: boolean;
  blobRedirectHost?: string;
} = {}): typeof fetch {
  const version = options.version ?? "v2026.08.24";
  const revision = options.revision ?? SOURCE_SHA;
  const config = {
    architecture: "amd64",
    os: "linux",
    config: {
      Labels: {
        "org.opencontainers.image.version": version,
        "org.opencontainers.image.revision": revision,
      },
    },
  };
  const configBody = JSON.stringify(config);
  const configDigest = digest(configBody);
  const platform = {
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    config: { mediaType: "application/vnd.oci.image.config.v1+json", digest: configDigest, size: configBody.length },
    layers: [],
  };
  const platformBody = JSON.stringify(platform);
  const platformDigest = digest(platformBody);
  const channel = {
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.index.v1+json",
    manifests: [
      {
        mediaType: "application/vnd.oci.image.manifest.v1+json",
        digest: platformDigest,
        size: 123,
        platform: { os: "linux", architecture: "amd64" },
      },
      ...(options.duplicatePlatform
        ? [{
            mediaType: "application/vnd.oci.image.manifest.v1+json",
            digest: `sha256:${"4".repeat(64)}`,
            size: 123,
            platform: { os: "linux", architecture: "amd64" },
          }]
        : []),
    ],
  };
  const channelBody = JSON.stringify(channel);
  const immutableTags = options.immutableTags ?? ["v2026.08.24"];
  let authenticated = false;

  return (async (input, init) => {
    const url = String(input);
    const auth = new Headers(init?.headers).get("authorization");
    if (url.startsWith("https://ghcr.io/token?")) {
      authenticated = true;
      return Response.json({ token: "registry-token" });
    }
    if (!auth && !authenticated) {
      return new Response("unauthorized", {
        status: 401,
        headers: {
          "www-authenticate": `Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:${REPO}:pull"`,
        },
      });
    }
    if (url.endsWith(`/manifests/latest`)) {
      return new Response(channelBody, {
        status: 200,
        headers: {
          "content-type": "application/vnd.oci.image.index.v1+json",
          "docker-content-digest": options.tamperChannelDigest
            ? `sha256:${"f".repeat(64)}`
            : digest(channelBody),
        },
      });
    }
    if (url.endsWith(`/manifests/${encodeURIComponent(platformDigest)}`)) {
      return new Response(platformBody, {
        status: 200,
        headers: {
          "content-type": "application/vnd.oci.image.manifest.v1+json",
          "docker-content-digest": platformDigest,
        },
      });
    }
    if (url.endsWith(`/blobs/${configDigest}`)) {
      if (options.blobRedirectHost) {
        return new Response(null, {
          status: 307,
          headers: {
            location: `https://${options.blobRedirectHost}/ghcrblobs/config`,
          },
        });
      }
      return new Response(configBody, {
        status: 200,
        headers: {
          "content-type": "application/vnd.oci.image.config.v1+json",
          "docker-content-digest": configDigest,
        },
      });
    }
    if (url === "https://pkg-containers.githubusercontent.com/ghcrblobs/config") {
      return new Response(configBody, {
        status: 200,
        headers: {
          "content-type": "application/vnd.oci.image.config.v1+json",
        },
      });
    }
    if (url.includes("/tags/list")) {
      return Response.json({ name: REPO, tags: ["latest", ...immutableTags] });
    }
    const tag = decodeURIComponent(url.split("/manifests/")[1] ?? "");
    if (immutableTags.includes(tag)) {
      return new Response(channelBody, {
        status: 200,
        headers: {
          "content-type": "application/vnd.oci.image.index.v1+json",
          "docker-content-digest": digest(channelBody),
        },
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

describe("readRegistryReleaseCandidate", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("replaces a failed process-lifetime transport and retries the complete registry read once", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("poisoned process-lifetime fetch pool");
    }));
    const closeFailed = vi.fn(async () => undefined);
    const closeHealthy = vi.fn(async () => undefined);
    const transportFactory = vi.fn()
      .mockReturnValueOnce({
        fetch: vi.fn(async () => {
          throw new TypeError("fetch failed", {
            cause: new Error("Connect Timeout Error"),
          });
        }) as typeof fetch,
        close: closeFailed,
      })
      .mockReturnValueOnce({
        fetch: fixtureFetch(),
        close: closeHealthy,
      });

    const result = await readRegistryReleaseCandidate({
      owner: OWNER,
      channelTag: "latest",
      architecture: "amd64",
      transportFactory,
    });

    expect(result.ok).toBe(true);
    expect(transportFactory).toHaveBeenCalledTimes(2);
    expect(closeFailed).toHaveBeenCalledOnce();
    expect(closeHealthy).toHaveBeenCalledOnce();
  });

  it("keeps a byte-verified candidate when transport cleanup reports an error", async () => {
    const close = vi.fn(async () => {
      throw new Error("dispatcher already closed");
    });

    const result = await readRegistryReleaseCandidate({
      owner: OWNER,
      channelTag: "latest",
      architecture: "amd64",
      transportFactory: () => ({ fetch: fixtureFetch(), close }),
    });

    expect(result.ok).toBe(true);
    expect(close).toHaveBeenCalledOnce();
  });

  it("recovers when constructing the first isolated transport fails", async () => {
    const close = vi.fn(async () => undefined);
    const transportFactory = vi.fn()
      .mockImplementationOnce(() => {
        throw new TypeError("dispatcher construction failed");
      })
      .mockReturnValueOnce({ fetch: fixtureFetch(), close });

    const result = await readRegistryReleaseCandidate({
      owner: OWNER,
      channelTag: "latest",
      architecture: "amd64",
      transportFactory,
    });

    expect(result.ok).toBe(true);
    expect(transportFactory).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledOnce();
  });

  it("does not retry an integrity failure on a new transport", async () => {
    const close = vi.fn(async () => undefined);
    const transportFactory = vi.fn(() => ({
      fetch: fixtureFetch({ tamperChannelDigest: true }),
      close,
    }));

    const result = await readRegistryReleaseCandidate({
      owner: OWNER,
      channelTag: "latest",
      architecture: "amd64",
      transportFactory,
    });

    expect(result).toEqual({ ok: false, reason: "channel-digest-mismatch" });
    expect(transportFactory).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("resolves a verified channel to the immutable tag and byte identities", async () => {
    const result = await readRegistryReleaseCandidate({
      owner: OWNER,
      channelTag: "latest",
      architecture: "amd64",
      fetchImpl: fixtureFetch(),
    });

    expect(result).toEqual({
      ok: true,
      candidate: {
        tag: "v2026.08.24",
        sourceSha: SOURCE_SHA,
        channelDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        platformManifestDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        configDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        platformOs: "linux",
        platformArchitecture: "amd64",
      },
    });
  });

  it("fails closed when registry bytes do not match Docker-Content-Digest", async () => {
    const result = await readRegistryReleaseCandidate({
      owner: OWNER,
      channelTag: "latest",
      architecture: "amd64",
      fetchImpl: fixtureFetch({ tamperChannelDigest: true }),
    });
    expect(result).toEqual({ ok: false, reason: "channel-digest-mismatch" });
  });

  it("follows GHCR's config-blob redirect only to GitHub's package host", async () => {
    const allowed = await readRegistryReleaseCandidate({
      owner: OWNER,
      channelTag: "latest",
      architecture: "amd64",
      fetchImpl: fixtureFetch({ blobRedirectHost: "pkg-containers.githubusercontent.com" }),
    });
    expect(allowed.ok).toBe(true);

    const rejected = await readRegistryReleaseCandidate({
      owner: OWNER,
      channelTag: "latest",
      architecture: "amd64",
      fetchImpl: fixtureFetch({ blobRedirectHost: "example.com" }),
    });
    expect(rejected).toEqual({ ok: false, reason: "registry-redirect-invalid" });
  });

  it("fails closed when platform selection is ambiguous", async () => {
    const result = await readRegistryReleaseCandidate({
      owner: OWNER,
      channelTag: "latest",
      architecture: "amd64",
      fetchImpl: fixtureFetch({ duplicatePlatform: true }),
    });
    expect(result).toEqual({ ok: false, reason: "platform-manifest-ambiguous" });
  });

  it("recovers a legacy version=main image only from one matching immutable tag", async () => {
    const result = await readRegistryReleaseCandidate({
      owner: OWNER,
      channelTag: "latest",
      architecture: "amd64",
      fetchImpl: fixtureFetch({ version: "main", immutableTags: ["v2026.08.24"] }),
    });
    expect(result.ok && result.candidate.tag).toBe("v2026.08.24");
  });

  it("rejects zero or ambiguous legacy immutable tag matches", async () => {
    const zero = await readRegistryReleaseCandidate({
      owner: OWNER,
      channelTag: "latest",
      architecture: "amd64",
      fetchImpl: fixtureFetch({ version: "main", immutableTags: [] }),
    });
    expect(zero).toEqual({ ok: false, reason: "immutable-tag-not-found" });

    const ambiguous = await readRegistryReleaseCandidate({
      owner: OWNER,
      channelTag: "latest",
      architecture: "amd64",
      fetchImpl: fixtureFetch({
        version: "main",
        immutableTags: ["v2026.08.24", "v2026.08.24-review-routing.1"],
      }),
    });
    expect(ambiguous).toEqual({ ok: false, reason: "immutable-tag-ambiguous" });
  });

  it("rejects malformed source identity before returning a candidate", async () => {
    const result = await readRegistryReleaseCandidate({
      owner: OWNER,
      channelTag: "latest",
      architecture: "amd64",
      fetchImpl: fixtureFetch({ revision: "main" }),
    });
    expect(result).toEqual({ ok: false, reason: "source-revision-invalid" });
  });
});
