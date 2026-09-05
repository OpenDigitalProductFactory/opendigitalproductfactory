// EP-ZERO-CONFIG-FEDERATION — where a member's organization material lives.
// Spec: docs/superpowers/specs/2026-09-03-portal-mediated-organization-membership-design.md §5.2 step 5.
//
// Two homes, read in this order:
//   <federation state dir>/pki/   — written by the portal when a join file is
//                                   imported on the Connections page or through
//                                   the MCP tool. Read-write mount; survives
//                                   teardown with DPF_STATE_DIR.
//   /dpf-state/pki/               — written by the host bootstrap script on an
//                                   authority (or a member that joined by
//                                   script). Read-only mount.
// Each home holds root_ca.crt, authority.crt and authority.key; the portal home
// also holds membership.json, the join-file facts (CA URL, intended hostname,
// root fingerprint) a fresh database re-reads at boot.
//
// Every read tolerates an absent home — callers get null — and the writer is
// atomic and private (temp file + rename, mode 0600) like durable-state.ts.

import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join, posix } from "node:path";

import { isRecord } from "@/lib/shared/coerce";
import { getErrorMessage } from "@/lib/shared/get-error-message";

import { federationStateDir } from "./durable-state";
import { verifyMembershipChain } from "./membership-proof";

export interface MembershipMaterial {
  rootPem: string;
  rootFingerprint: string;
  certPem: string;
  keyPem: string;
}

export interface MembershipPaths {
  root: string;
  cert: string;
  key: string;
}

export const MEMBERSHIP_FACTS_FILE = "membership.json";
const LEGACY_PKI_DIR = "/dpf-state/pki";

/** The portal-owned material directory: `<federation state dir>/pki`. */
export function membershipMaterialDir(env: Record<string, string | undefined> = process.env): string {
  return join(federationStateDir(env), "pki");
}

function pathsIn(dir: string): MembershipPaths {
  // The script home is a container path; the portal home may be a host temp
  // directory under test, so it joins with the platform separator.
  const j = dir.startsWith("/") ? posix.join : join;
  return { root: j(dir, "root_ca.crt"), cert: j(dir, "authority.crt"), key: j(dir, "authority.key") };
}

/**
 * The legacy, script-written home. Explicit DPF_PKI_*_PATH overrides still win
 * for an operator who moved the PKI directory.
 */
export function membershipPaths(env: Record<string, string | undefined> = process.env): MembershipPaths {
  const legacy = pathsIn(LEGACY_PKI_DIR);
  return {
    root: env.DPF_PKI_ROOT_PATH?.trim() || legacy.root,
    cert: env.DPF_PKI_CERT_PATH?.trim() || legacy.cert,
    key: env.DPF_PKI_KEY_PATH?.trim() || legacy.key,
  };
}

/** Portal home first, script home second. */
export function membershipPathCandidates(env: Record<string, string | undefined> = process.env): MembershipPaths[] {
  return [pathsIn(membershipMaterialDir(env)), membershipPaths(env)];
}

type ReadText = (path: string) => Promise<string>;
const defaultReadText: ReadText = (path) => readFile(path, "utf8");

async function readMaterialAt(paths: MembershipPaths, read: ReadText, now: Date): Promise<MembershipMaterial | null> {
  try {
    const [rootPem, certPem, keyPem] = await Promise.all([read(paths.root), read(paths.cert), read(paths.key)]);
    const self = verifyMembershipChain({ chainPems: [certPem], pinnedRootPem: rootPem, now });
    if (!self.verified || !self.presentedRootFingerprint) return null;
    return { rootPem, rootFingerprint: self.presentedRootFingerprint, certPem, keyPem };
  } catch {
    return null;
  }
}

/** Read the join-file material from the first home that holds a valid set; null when this install has not joined an organization. */
export async function readMembershipMaterial(
  options: { env?: Record<string, string | undefined>; readText?: ReadText; now?: Date } = {},
): Promise<MembershipMaterial | null> {
  const read = options.readText ?? defaultReadText;
  const now = options.now ?? new Date();
  for (const paths of membershipPathCandidates(options.env)) {
    const material = await readMaterialAt(paths, read, now);
    if (material) return material;
  }
  return null;
}

/** Only the root, from the first home that has one: an authority that has not issued itself a member certificate can still ACCEPT proofs. */
export async function readPinnedRoot(
  options: { env?: Record<string, string | undefined>; readText?: ReadText; now?: Date } = {},
): Promise<{ rootPem: string; rootFingerprint: string } | null> {
  const read = options.readText ?? defaultReadText;
  const now = options.now ?? new Date();
  for (const paths of membershipPathCandidates(options.env)) {
    try {
      const rootPem = await read(paths.root);
      const self = verifyMembershipChain({ chainPems: [rootPem], pinnedRootPem: rootPem, now });
      if (self.verified && self.presentedRootFingerprint) return { rootPem, rootFingerprint: self.presentedRootFingerprint };
    } catch {
      // try the next home
    }
  }
  return null;
}

/** The facts the join file carried, kept beside the material so a fresh database re-reads them. */
export interface MembershipFactsV1 {
  schemaVersion: 1;
  caUrl: string;
  intendedPeer: string;
  rootFingerprint: string;
  packageId: string;
  joinedAt: string;
}

export function parseMembershipFacts(value: unknown): MembershipFactsV1 | null {
  if (!isRecord(value) || value.schemaVersion !== 1) return null;
  const s = (k: string) => (typeof value[k] === "string" ? (value[k] as string) : "");
  if (!s("caUrl") || !s("intendedPeer") || !/^[a-f0-9]{64}$/.test(s("rootFingerprint"))) return null;
  return {
    schemaVersion: 1,
    caUrl: s("caUrl"),
    intendedPeer: s("intendedPeer"),
    rootFingerprint: s("rootFingerprint"),
    packageId: s("packageId"),
    joinedAt: s("joinedAt") || new Date(0).toISOString(),
  };
}

export async function readMembershipFacts(
  options: { env?: Record<string, string | undefined>; readText?: ReadText } = {},
): Promise<MembershipFactsV1 | null> {
  const read = options.readText ?? defaultReadText;
  try {
    return parseMembershipFacts(JSON.parse((await read(join(membershipMaterialDir(options.env), MEMBERSHIP_FACTS_FILE))).replace(/^﻿/, "")));
  } catch {
    return null;
  }
}

async function writePrivate(target: string, content: string): Promise<void> {
  const temp = `${target}.${process.pid}.tmp`;
  await writeFile(temp, content, { encoding: "utf8", mode: 0o600 });
  try { await chmod(temp, 0o600); } catch { /* Windows bind mounts ignore modes */ }
  await rename(temp, target);
}

/**
 * Write the material set and the facts file into the portal home. The
 * federation state directory itself must already exist (the compose mount
 * provides it); only the `pki` subdirectory is created here. Returns false,
 * never throws, when the home is not writable — the caller reports it.
 */
export async function writeMembershipMaterial(
  input: { rootPem: string; certPem: string; keyPem: string; facts: MembershipFactsV1 },
  options: { env?: Record<string, string | undefined>; dir?: string } = {},
): Promise<{ written: true; dir: string } | { written: false; reason: string }> {
  const dir = options.dir ?? membershipMaterialDir(options.env);
  try {
    const parent = join(dir, "..");
    if (!(await stat(parent)).isDirectory()) return { written: false, reason: `federation state directory is not a directory: ${parent}` };
  } catch {
    return { written: false, reason: "federation state directory is not mounted" };
  }
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const paths = pathsIn(dir);
    await writePrivate(paths.key, input.keyPem);
    await writePrivate(paths.cert, input.certPem);
    await writePrivate(paths.root, input.rootPem);
    await writePrivate(join(dir, MEMBERSHIP_FACTS_FILE), JSON.stringify(input.facts, null, 2));
    return { written: true, dir };
  } catch (error) {
    return { written: false, reason: getErrorMessage(error) };
  }
}
