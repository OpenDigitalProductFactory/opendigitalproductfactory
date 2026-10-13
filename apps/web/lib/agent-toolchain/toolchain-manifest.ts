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
import { mcpClientBearerHeaderRequired, type McpClient } from "@dpf/integration-shared/mcp-client-credential-policy";

import { buildPackArchive } from "./pack-archive";
import { deliveredDigest, listPackFiles } from "./pack-digest";

export const TOOLCHAIN_MANIFEST_SCHEMA_VERSION = 1;

/** The client kinds that load the dpf-platform pack, and their credential-policy key. */
export const TOOLCHAIN_CLIENT_KINDS: Readonly<Record<string, McpClient>> = Object.freeze({
  "claude-code": "claude",
  codex: "codex",
  grok: "grok",
  antigravity: "antigravity",
});

export type ToolchainFloor = { minPackVersion: string | null; graceStartsAt: string | null };

export type ToolchainClientShape = {
  /** Auth the connector uses at this endpoint, from mcpClientBearerHeaderRequired. */
  authMode: "oauth" | "bearer";
  /** How the declaration rides the connection (design §5.2); query until the P1 spike says otherwise. */
  declarationCarrier: "query" | "header";
  /** False until the carrier spike verifies it for this client. */
  carrierVerified: boolean;
};

export type UnsignedToolchainManifest = {
  schemaVersion: number;
  packVersion: string;
  packDigest: string;
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

export function clientShapes(mcpEndpoint: string): Record<string, ToolchainClientShape> {
  return Object.fromEntries(
    Object.entries(TOOLCHAIN_CLIENT_KINDS).map(([kind, policyClient]) => [
      kind,
      {
        authMode: mcpClientBearerHeaderRequired(mcpEndpoint, policyClient) ? "bearer" : "oauth",
        declarationCarrier: "query",
        carrierVerified: false,
      } satisfies ToolchainClientShape,
    ]),
  );
}

/** Pure: build the archive and unsigned manifest for one pack tree. */
export function buildToolchainRelease(input: {
  packRoot: string;
  releaseId: string | null;
  mcpEndpoint: string;
}): { manifest: UnsignedToolchainManifest; archive: Buffer } {
  const { packVersion, floor } = readVersionSource(input.packRoot);
  const archive = buildPackArchive(input.packRoot, listPackFiles(input.packRoot));
  return {
    archive,
    manifest: {
      schemaVersion: TOOLCHAIN_MANIFEST_SCHEMA_VERSION,
      packVersion,
      packDigest: deliveredDigest(input.packRoot),
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
