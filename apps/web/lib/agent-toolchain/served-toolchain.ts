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

/** Test seam. */
export function _resetServedToolchainCache(): void {
  cache.clear();
}
