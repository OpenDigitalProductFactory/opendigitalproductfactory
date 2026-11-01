import "server-only";

// BI-52934B3E — the toolchain manifest a release publishes (design
// 2026-10-07-agent-toolchain-release-delivery §5.1).
//
// The pack is read from the IMAGE (`packages/dpf-skill-pack` next to the app),
// never from DPF_REPO_ROOT: on an installed portal that names the install
// folder, which carries no packages. The manifest and archive are computed
// once per process; nothing on the request path re-hashes the tree.
//
// Authenticity: the canonical manifest bytes are signed with the
// installation's existing Ed25519 federation identity, and the signature,
// public key and device id ship with the manifest. The updater accepts a pack
// only when that device id equals the one its authenticated MCP connection
// reports (§5.1, §5.3). Failing to sign is not degraded to an unsigned
// manifest: the route refuses instead.

import { createHash, createPrivateKey, sign as edSign } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { clientCapabilityRow, type ClientCapabilityRow } from "@dpf/integration-shared/client-capability-profile";
import { mcpClientBearerHeaderRequired } from "@dpf/integration-shared/mcp-client-credential-policy";

import { buildPackArchive } from "./pack-archive";
import { deliveredDigest, deliveredVersion, listPackFiles } from "./pack-digest";
import { DECLARING_CLIENT_KINDS } from "./toolchain-verdict";

export const TOOLCHAIN_MANIFEST_SCHEMA_VERSION = 1;

/** The client kinds that load the dpf-platform pack; one home, in toolchain-verdict.ts. */
export const TOOLCHAIN_CLIENT_KINDS = DECLARING_CLIENT_KINDS;

export type ToolchainFloor = { minPackVersion: string | null; graceStartsAt: string | null };

export type ToolchainClientShape = {
  /** Auth the connector uses at this endpoint, from mcpClientBearerHeaderRequired. */
  authMode: "oauth" | "bearer";
  /** How the declaration rides the connection (design §5.2), from the capability profile; see DECLARATION_CARRIERS. */
  declarationCarrier: "query" | "header";
  /** True only once the profile records the carrier as verified for this client. */
  carrierVerified: boolean;
  /** The client's row of packages/dpf-skill-pack/client-capabilities.json (BI-64795FD0). */
  capabilities: ClientCapabilityRow | null;
};

export type UnsignedToolchainManifest = {
  schemaVersion: number;
  packVersion: string;
  packDigest: string;
  /**
   * The version a delivery stamps into client manifests (BI-4F9E3221):
   * `<packVersion>+c.<packDigest[0:12]>`. Version-keyed client caches refresh
   * on it, so content never needs a manual packVersion bump to ship.
   */
  deliveredVersion: string;
  archiveSha256: string;
  releaseId: string | null;
  mcpEndpoint: string;
  floor: ToolchainFloor;
  clients: Record<string, ToolchainClientShape>;
  updater: { path: string };
};

export type SignedToolchainManifest = UnsignedToolchainManifest & {
  deviceId: string;
  signingPublicKey: string;
  /** Ed25519 over canonicalJson(UnsignedToolchainManifest), base64. */
  signature: string;
};

export type ToolchainSigner = {
  deviceId: string;
  signingPublicKey: string;
  /** PKCS8 DER, base64. */
  signingPrivateKey: string;
};

/** The image's own pack directory, or null outside an image/repo layout. */
export function resolvePackRoot(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string | null {
  const candidates = [
    env.DPF_SKILL_PACK_ROOT?.trim(),
    join(cwd, "..", "..", "packages", "dpf-skill-pack"),
    join(cwd, "packages", "dpf-skill-pack"),
  ].filter((value): value is string => Boolean(value));
  return candidates.find((candidate) => existsSync(join(candidate, "toolchain-version.json"))) ?? null;
}

function readVersionSource(root: string): { packVersion: string; floor: ToolchainFloor } {
  const source = JSON.parse(readFileSync(join(root, "toolchain-version.json"), "utf8")) as {
    packVersion?: unknown;
    floor?: { minPackVersion?: unknown; graceStartsAt?: unknown };
  };
  if (typeof source.packVersion !== "string") throw new Error("toolchain-version.json has no packVersion");
  const asNullableString = (value: unknown) => (typeof value === "string" ? value : null);
  return {
    packVersion: source.packVersion,
    floor: {
      minPackVersion: asNullableString(source.floor?.minPackVersion),
      graceStartsAt: asNullableString(source.floor?.graceStartsAt),
    },
  };
}

/**
 * How each client's connector carries its declaration (BI-DE1E6485, design §5.2).
 * The header leaves the connector URL alone, so the OAuth resource, the stored
 * sign-in and the desktop app's URL check do not change with each release, and
 * a `${DPF_MCP_URL:-…}` template never needs a query appended after it. Grok
 * authenticates with a bearer and its descriptor URL is literal, so it keeps
 * the query. Since BI-64795FD0 the values come from the capability profile
 * (client-capabilities.json, declarationCarrier); the profile generator checks
 * they equal the updater's fallback, toolchain_convergence.DEFAULT_CARRIERS.
 * The updater reads this map from the signed manifest. Unverified until the
 * carrier spike measures it.
 */
export const DECLARATION_CARRIERS: Readonly<Record<string, ToolchainClientShape["declarationCarrier"]>> = Object.freeze(
  Object.fromEntries(
    Object.keys(TOOLCHAIN_CLIENT_KINDS).map((kind) => [
      kind,
      clientCapabilityRow(kind)?.capabilities.declarationCarrier.value ?? "header",
    ]),
  ),
);

export function clientShapes(mcpEndpoint: string): Record<string, ToolchainClientShape> {
  return Object.fromEntries(
    Object.entries(TOOLCHAIN_CLIENT_KINDS).map(([kind, policyClient]) => {
      const capabilities = clientCapabilityRow(kind);
      return [
        kind,
        {
          authMode: mcpClientBearerHeaderRequired(mcpEndpoint, policyClient) ? "bearer" : "oauth",
          declarationCarrier: DECLARATION_CARRIERS[kind] ?? "header",
          carrierVerified: capabilities?.capabilities.declarationCarrier.status === "verified",
          capabilities,
        } satisfies ToolchainClientShape,
      ];
    }),
  );
}

/** Version, delivered digest and floor of one pack tree: what a connection is compared with. */
export function readPublishedToolchain(packRoot: string): { packVersion: string; packDigest: string; floor: ToolchainFloor } {
  const { packVersion, floor } = readVersionSource(packRoot);
  return { packVersion, packDigest: deliveredDigest(packRoot), floor };
}

/** Pure: build the archive and unsigned manifest for one pack tree. */
export function buildToolchainRelease(input: {
  packRoot: string;
  releaseId: string | null;
  mcpEndpoint: string;
}): { manifest: UnsignedToolchainManifest; archive: Buffer } {
  const { packVersion, floor } = readVersionSource(input.packRoot);
  const archive = buildPackArchive(input.packRoot, listPackFiles(input.packRoot));
  const packDigest = deliveredDigest(input.packRoot);
  return {
    archive,
    manifest: {
      schemaVersion: TOOLCHAIN_MANIFEST_SCHEMA_VERSION,
      packVersion,
      packDigest,
      deliveredVersion: deliveredVersion(packVersion, packDigest),
      archiveSha256: createHash("sha256").update(archive).digest("hex"),
      releaseId: input.releaseId,
      mcpEndpoint: input.mcpEndpoint,
      floor,
      clients: clientShapes(input.mcpEndpoint),
      updater: { path: "scripts/update_agent_toolchain.py" },
    },
  };
}

/** Sign the canonical manifest bytes with the installation identity. */
export function signToolchainManifest(
  manifest: UnsignedToolchainManifest,
  signer: ToolchainSigner,
): SignedToolchainManifest {
  const key = createPrivateKey({ key: Buffer.from(signer.signingPrivateKey, "base64"), format: "der", type: "pkcs8" });
  const signature = edSign(null, Buffer.from(canonicalJson(manifest), "utf8"), key).toString("base64");
  return { ...manifest, deviceId: signer.deviceId, signingPublicKey: signer.signingPublicKey, signature };
}
