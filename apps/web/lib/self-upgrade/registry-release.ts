import { createHash } from "node:crypto";
import { ok, type ActionSuccess } from "@/lib/shared/action-result";

const DEFAULT_REGISTRY_ORIGIN = "https://ghcr.io";
const DEFAULT_REPOSITORY = "dpf-portal";
const MANIFEST_ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_CONFIG_BYTES = 2 * 1024 * 1024;
const MAX_TOKEN_BYTES = 16 * 1024;
const MAX_TAG_LIST_BYTES = 256 * 1024;
const MAX_LEGACY_TAGS = 200;
const LEGACY_CONCURRENCY = 8;

export const RELEASE_IMAGE_TAG = /^v\d+\.\d+\.\d+([-+][A-Za-z0-9.-]+)?$/;
const OCI_TAG = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const REGISTRY_OWNER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;
const SHA_256 = /^sha256:[a-f0-9]{64}$/;
const SOURCE_SHA = /^[a-f0-9]{40}$/i;

export type RegistryReleaseCandidate = Readonly<{
  tag: string;
  sourceSha: string;
  channelDigest: string;
  platformManifestDigest: string;
  configDigest: string;
  platformOs: "linux";
  platformArchitecture: string;
}>;

export type RegistryReleaseFailureReason =
  | "registry-identity-invalid"
  | "registry-unavailable"
  | "registry-response-too-large"
  | "registry-auth-invalid"
  | "registry-redirect-invalid"
  | "channel-manifest-invalid"
  | "channel-digest-missing"
  | "channel-digest-mismatch"
  | "platform-manifest-missing"
  | "platform-manifest-ambiguous"
  | "platform-manifest-invalid"
  | "platform-digest-mismatch"
  | "image-config-invalid"
  | "config-digest-mismatch"
  | "source-revision-invalid"
  | "immutable-tag-invalid"
  | "immutable-tag-mismatch"
  | "immutable-tag-not-found"
  | "immutable-tag-ambiguous"
  | "tag-list-limit";

export type RegistryReleaseReadResult =
  | (ActionSuccess & { candidate: RegistryReleaseCandidate })
  | { ok: false; reason: RegistryReleaseFailureReason };

type ManifestDescriptor = {
  mediaType?: unknown;
  digest?: unknown;
  platform?: { os?: unknown; architecture?: unknown };
};

type RegistryIndex = {
  schemaVersion?: unknown;
  manifests?: unknown;
};

type RegistryManifest = {
  schemaVersion?: unknown;
  config?: { digest?: unknown };
};

type RegistryConfig = {
  architecture?: unknown;
  os?: unknown;
  config?: { Labels?: Record<string, unknown> };
};

class RegistryReadError extends Error {
  constructor(readonly reason: RegistryReleaseFailureReason) {
    super(reason);
  }
}

function sha256(body: Uint8Array): string {
  return `sha256:${createHash("sha256").update(body).digest("hex")}`;
}

async function readBounded(response: Response, limit: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) {
    throw new RegistryReadError("registry-response-too-large");
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new RegistryReadError("registry-response-too-large");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function parseJson(body: Uint8Array, reason: RegistryReleaseFailureReason): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new RegistryReadError(reason);
  }
}

function parseBearerChallenge(value: string | null, expectedHost: string): URL {
  if (!value?.startsWith("Bearer ")) throw new RegistryReadError("registry-auth-invalid");
  const fields = new Map<string, string>();
  for (const match of value.slice(7).matchAll(/([a-z]+)="([^"]*)"/gi)) {
    fields.set(match[1].toLowerCase(), match[2]);
  }
  const realm = fields.get("realm");
  if (!realm) throw new RegistryReadError("registry-auth-invalid");
  let tokenUrl: URL;
  try {
    tokenUrl = new URL(realm);
  } catch {
    throw new RegistryReadError("registry-auth-invalid");
  }
  if (tokenUrl.protocol !== "https:" || tokenUrl.hostname !== expectedHost) {
    throw new RegistryReadError("registry-auth-invalid");
  }
  for (const key of ["service", "scope"] as const) {
    const field = fields.get(key);
    if (field) tokenUrl.searchParams.set(key, field);
  }
  return tokenUrl;
}

function registryArchitecture(architecture?: string): string {
  const value = architecture ?? process.arch;
  if (value === "x64") return "amd64";
  return value;
}

function verifiedDigest(
  response: Response,
  body: Uint8Array,
  missingReason: RegistryReleaseFailureReason,
  mismatchReason: RegistryReleaseFailureReason,
  expected?: string,
  requireHeader = true,
): string {
  const header = response.headers.get("docker-content-digest")?.toLowerCase() ?? "";
  const computed = sha256(body);
  if (header && !SHA_256.test(header)) throw new RegistryReadError(missingReason);
  if (requireHeader && !header) throw new RegistryReadError(missingReason);
  if (
    (header && computed !== header) ||
    (expected && expected.toLowerCase() !== computed) ||
    (expected && header && expected.toLowerCase() !== header)
  ) {
    throw new RegistryReadError(mismatchReason);
  }
  return header || computed;
}

export async function readRegistryReleaseCandidate(input: {
  owner: string;
  channelTag: string;
  architecture?: string;
  repository?: string;
  registryOrigin?: string;
  fetchImpl?: typeof fetch;
}): Promise<RegistryReleaseReadResult> {
  const repository = input.repository ?? DEFAULT_REPOSITORY;
  const origin = input.registryOrigin ?? DEFAULT_REGISTRY_ORIGIN;
  if (!REGISTRY_OWNER.test(input.owner) || !OCI_TAG.test(input.channelTag) || !/^[a-z0-9._-]+$/.test(repository)) {
    return { ok: false, reason: "registry-identity-invalid" };
  }

  try {
    const originUrl = new URL(origin);
    if (originUrl.protocol !== "https:") throw new RegistryReadError("registry-identity-invalid");
    const fetchImpl = input.fetchImpl ?? fetch;
    const imageName = `${input.owner.toLowerCase()}/${repository}`;
    let bearer: string | null = null;

    async function request(
      path: string,
      accept?: string,
      redirect: RequestRedirect = "error",
    ): Promise<Response> {
      const headers: Record<string, string> = {};
      if (accept) headers.Accept = accept;
      if (bearer) headers.Authorization = `Bearer ${bearer}`;
      let response = await fetchImpl(`${originUrl.origin}${path}`, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(10_000),
        redirect,
      });
      if (response.status !== 401 || bearer) return response;

      const tokenUrl = parseBearerChallenge(
        response.headers.get("www-authenticate"),
        originUrl.hostname,
      );
      const tokenResponse = await fetchImpl(tokenUrl, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
        redirect,
      });
      if (!tokenResponse.ok) throw new RegistryReadError("registry-auth-invalid");
      const tokenBody = parseJson(
        await readBounded(tokenResponse, MAX_TOKEN_BYTES),
        "registry-auth-invalid",
      ) as { token?: unknown; access_token?: unknown };
      const token = typeof tokenBody.token === "string"
        ? tokenBody.token
        : typeof tokenBody.access_token === "string"
          ? tokenBody.access_token
          : null;
      if (!token || token.length > 16_384) throw new RegistryReadError("registry-auth-invalid");
      bearer = token;
      headers.Authorization = `Bearer ${bearer}`;
      response = await fetchImpl(`${originUrl.origin}${path}`, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(10_000),
        redirect: "error",
      });
      return response;
    }

    async function manifest(reference: string, expectedDigest?: string): Promise<{
      json: unknown;
      digest: string;
    }> {
      const response = await request(
        `/v2/${imageName}/manifests/${encodeURIComponent(reference)}`,
        MANIFEST_ACCEPT,
      );
      if (!response.ok) throw new RegistryReadError("registry-unavailable");
      const body = await readBounded(response, MAX_MANIFEST_BYTES);
      const digest = verifiedDigest(
        response,
        body,
        "channel-digest-missing",
        expectedDigest ? "platform-digest-mismatch" : "channel-digest-mismatch",
        expectedDigest,
      );
      return { json: parseJson(body, "channel-manifest-invalid"), digest };
    }

    async function blob(digest: string): Promise<Response> {
      const response = await request(`/v2/${imageName}/blobs/${digest}`, undefined, "manual");
      if (![302, 307].includes(response.status)) return response;

      const location = response.headers.get("location");
      let redirect: URL;
      try {
        redirect = new URL(location ?? "");
      } catch {
        throw new RegistryReadError("registry-redirect-invalid");
      }
      if (
        redirect.protocol !== "https:" ||
        redirect.hostname !== "pkg-containers.githubusercontent.com" ||
        redirect.port ||
        redirect.username ||
        redirect.password ||
        redirect.hash
      ) {
        throw new RegistryReadError("registry-redirect-invalid");
      }
      return fetchImpl(redirect, {
        method: "GET",
        headers: { Accept: "application/octet-stream" },
        signal: AbortSignal.timeout(10_000),
        redirect: "error",
      });
    }

    const channel = await manifest(input.channelTag);
    const index = channel.json as RegistryIndex;
    if (index.schemaVersion !== 2 || !Array.isArray(index.manifests)) {
      throw new RegistryReadError("channel-manifest-invalid");
    }
    const architecture = registryArchitecture(input.architecture);
    const matches = (index.manifests as ManifestDescriptor[]).filter(
      (descriptor) =>
        descriptor?.platform?.os === "linux" &&
        descriptor.platform.architecture === architecture &&
        typeof descriptor.digest === "string" &&
        SHA_256.test(descriptor.digest),
    );
    if (matches.length === 0) throw new RegistryReadError("platform-manifest-missing");
    if (matches.length !== 1) throw new RegistryReadError("platform-manifest-ambiguous");
    const platformManifestDigest = matches[0].digest as string;

    const platformRead = await manifest(platformManifestDigest, platformManifestDigest);
    const platform = platformRead.json as RegistryManifest;
    const configDigest = platform?.config?.digest;
    if (platform.schemaVersion !== 2 || typeof configDigest !== "string" || !SHA_256.test(configDigest)) {
      throw new RegistryReadError("platform-manifest-invalid");
    }

    const configResponse = await blob(configDigest);
    if (!configResponse.ok) throw new RegistryReadError("registry-unavailable");
    const configBody = await readBounded(configResponse, MAX_CONFIG_BYTES);
    verifiedDigest(
      configResponse,
      configBody,
      "image-config-invalid",
      "config-digest-mismatch",
      configDigest,
      false,
    );
    const config = parseJson(configBody, "image-config-invalid") as RegistryConfig;
    if (config.os !== "linux" || config.architecture !== architecture) {
      throw new RegistryReadError("image-config-invalid");
    }
    const labels = config.config?.Labels ?? {};
    const sourceSha = labels["org.opencontainers.image.revision"];
    const stampedVersion = labels["org.opencontainers.image.version"];
    if (typeof sourceSha !== "string" || !SOURCE_SHA.test(sourceSha)) {
      throw new RegistryReadError("source-revision-invalid");
    }

    async function digestForTag(tag: string): Promise<string | null> {
      try {
        return (await manifest(tag)).digest;
      } catch {
        return null;
      }
    }

    let immutableTag: string;
    if (typeof stampedVersion === "string" && RELEASE_IMAGE_TAG.test(stampedVersion)) {
      immutableTag = stampedVersion;
      const immutableDigest = await digestForTag(immutableTag);
      if (!immutableDigest) throw new RegistryReadError("immutable-tag-invalid");
      if (immutableDigest !== channel.digest) throw new RegistryReadError("immutable-tag-mismatch");
    } else {
      const tagsResponse = await request(`/v2/${imageName}/tags/list?n=${MAX_LEGACY_TAGS}`);
      if (!tagsResponse.ok) throw new RegistryReadError("registry-unavailable");
      const tagsBody = parseJson(
        await readBounded(tagsResponse, MAX_TAG_LIST_BYTES),
        "channel-manifest-invalid",
      ) as { tags?: unknown };
      if (!Array.isArray(tagsBody.tags)) throw new RegistryReadError("channel-manifest-invalid");
      if (tagsResponse.headers.has("link") || tagsBody.tags.length > MAX_LEGACY_TAGS) {
        throw new RegistryReadError("tag-list-limit");
      }
      const releaseTags = tagsBody.tags.filter(
        (tag): tag is string => typeof tag === "string" && RELEASE_IMAGE_TAG.test(tag),
      );
      const matching: string[] = [];
      for (let offset = 0; offset < releaseTags.length; offset += LEGACY_CONCURRENCY) {
        const batch = releaseTags.slice(offset, offset + LEGACY_CONCURRENCY);
        const digests = await Promise.all(batch.map(async (tag) => ({ tag, digest: await digestForTag(tag) })));
        matching.push(...digests.filter((entry) => entry.digest === channel.digest).map((entry) => entry.tag));
        if (matching.length > 1) break;
      }
      if (matching.length === 0) throw new RegistryReadError("immutable-tag-not-found");
      if (matching.length !== 1) throw new RegistryReadError("immutable-tag-ambiguous");
      immutableTag = matching[0];
    }

    return {
      ...ok(),
      candidate: Object.freeze({
        tag: immutableTag,
        sourceSha: sourceSha.toLowerCase(),
        channelDigest: channel.digest,
        platformManifestDigest,
        configDigest,
        platformOs: "linux",
        platformArchitecture: architecture,
      }),
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof RegistryReadError ? error.reason : "registry-unavailable",
    };
  }
}
