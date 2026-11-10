import "server-only";

// BI-52934B3E — the toolchain this process serves, computed once.
//
// The pack bytes are part of the immutable image, so the archive, digest and
// signature are computed on first use and reused for the life of the process.
// The cache is keyed by MCP endpoint because an unconfigured loopback install
// names its origin from the request.

import { readImageVersion } from "@/lib/platform/image-version";

import {
  buildToolchainRelease,
  readPublishedToolchain,
  resolvePackRoot,
  signToolchainManifest,
  type SignedToolchainManifest,
  type ToolchainSigner,
} from "./toolchain-manifest";

export type ServedToolchain = { manifest: SignedToolchainManifest; archive: Buffer };

export type ServedToolchainDeps = {
  packRoot: () => string | null;
  releaseId: () => Promise<string | null>;
  signer: () => Promise<ToolchainSigner>;
};

async function defaultSigner(): Promise<ToolchainSigner> {
  const [{ prisma }, { resolveFederationSigningIdentity }] = await Promise.all([
    import("@dpf/db"),
    import("@/lib/federation/demand-identity"),
  ]);
  const identity = await resolveFederationSigningIdentity(prisma as never);
  return {
    deviceId: identity.deviceId,
    signingPublicKey: identity.signingPublicKey,
    signingPrivateKey: identity.signingPrivateKey,
  };
}

const defaultDeps: ServedToolchainDeps = {
  packRoot: () => resolvePackRoot(),
  releaseId: async () => (await readImageVersion())?.raw ?? null,
  signer: defaultSigner,
};

const cache = new Map<string, Promise<ServedToolchain>>();

/** The signed manifest and archive for `mcpEndpoint`; throws when the pack or key is unavailable. */
export function getServedToolchain(mcpEndpoint: string, deps: ServedToolchainDeps = defaultDeps): Promise<ServedToolchain> {
  let entry = cache.get(mcpEndpoint);
  if (!entry) {
    entry = (async () => {
      const packRoot = deps.packRoot();
      if (!packRoot) throw new Error("agent toolchain pack is not present in this image");
      const { manifest, archive } = buildToolchainRelease({
        packRoot,
        releaseId: await deps.releaseId(),
        mcpEndpoint,
      });
      return { manifest: signToolchainManifest(manifest, await deps.signer()), archive };
    })();
    // A failed build is not cached: the next request retries (e.g. identity provisioned later).
    entry.catch(() => cache.delete(mcpEndpoint));
    cache.set(mcpEndpoint, entry);
  }
  return entry;
}

let published: { packVersion: string; packDigest: string; floor: { minPackVersion: string | null; graceStartsAt: string | null } } | null | undefined;

/**
 * The released pack's version, digest and floor, computed once per process.
 * Needs no signing key, so connection verdicts work even when the manifest
 * route cannot sign. Null when the image carries no pack.
 */
export function getPublishedToolchain(packRoot: () => string | null = defaultDeps.packRoot) {
  if (published === undefined) {
    const root = packRoot();
    published = root ? readPublishedToolchain(root) : null;
  }
  return published;
}

let installationId: Promise<string | null> | undefined;

/** This installation's full device id (did_…), the identity its manifests are signed with; null when unavailable. */
export function getInstallationDeviceId(signer: () => Promise<ToolchainSigner> = defaultDeps.signer): Promise<string | null> {
  if (installationId === undefined) {
    installationId = signer().then(
      (identity) => identity.deviceId,
      () => {
        installationId = undefined;
        return null;
      },
    );
  }
  return installationId;
}

/** Test seam. */
export function _resetServedToolchainCache(): void {
  cache.clear();
  published = undefined;
  installationId = undefined;
}
