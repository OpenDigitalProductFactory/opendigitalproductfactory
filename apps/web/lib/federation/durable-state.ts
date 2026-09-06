// EP-ZERO-CONFIG-FEDERATION — the portal-owned, teardown-surviving federation
// state directory. Spec: docs/superpowers/specs/2026-09-02-zero-configuration-
// organization-federation-design.md §5.1–5.2.
//
// The base compose file mounts `${DPF_STATE_DIR}/federation` read-write at
// /dpf-federation. Two files live there, both mode 0600:
//   identity.json — this installation's federation identity (the file wins
//                   over the database row; the row is a cache).
//   peers.json    — the peer ledger: every non-revoked link with the material
//                   needed to recreate it in a fresh database.
//
// Every read tolerates an absent or unwritable directory: callers get `null`
// and a stance of `durable: false`, never a thrown error, so an install whose
// operator moved the state directory keeps working exactly as before.

import { readFile, rename, writeFile, chmod, stat } from "node:fs/promises";
import { join } from "node:path";

import { isRecord } from "@/lib/shared/coerce";

export const DEFAULT_FEDERATION_STATE_DIR = "/dpf-federation";

export function federationStateDir(env: Record<string, string | undefined> = process.env): string {
  return env.DPF_FEDERATION_STATE_DIR?.trim() || DEFAULT_FEDERATION_STATE_DIR;
}

export interface DurableFederationIdentityV1 {
  schemaVersion: 1;
  installationId: string;
  projectionSecret: string;
  deviceId: string;
  signingPublicKey: string;
  /** PKCS8 DER, base64 — in clear, protected by the directory's mode. */
  signingPrivateKey: string;
  writtenAt: string;
}

export interface DurablePeerLinkV1 {
  linkId: string;
  role: string;
  peerAuthorityUrl: string;
  peerInstallationId: string | null;
  peerDeviceId: string | null;
  peerOrganizationRef: string | null;
  localOrganizationId: string | null;
  displayName: string;
  tokenHash: string | null;
  tokenPrefix: string | null;
  /** Peer-issued bearer token in clear; null when the link is one-directional. */
  peerToken: string | null;
  approvedAtLocal: string | null;
  approvedAtPeer: string | null;
  approvedByPrincipalId: string | null;
  enrolledAt: string | null;
  quarantinedAt: string | null;
  quarantineReason: string | null;
  metadata: unknown;
}

export interface DurablePeerLedgerV1 {
  schemaVersion: 1;
  writtenAt: string;
  links: DurablePeerLinkV1[];
}

export interface DurableFederationStore {
  readIdentity(): Promise<DurableFederationIdentityV1 | null>;
  writeIdentity(identity: DurableFederationIdentityV1): Promise<boolean>;
  readLedger(): Promise<DurablePeerLedgerV1 | null>;
  writeLedger(ledger: DurablePeerLedgerV1): Promise<boolean>;
  /** True when the directory exists and is writable. */
  available(): Promise<boolean>;
}

const IDENTITY_FILE = "identity.json";
const LEDGER_FILE = "peers.json";

export function parseDurableIdentity(value: unknown): DurableFederationIdentityV1 | null {
  if (!isRecord(value) || value.schemaVersion !== 1) return null;
  const s = (k: string) => (typeof value[k] === "string" ? (value[k] as string) : "");
  if (!/^inst_[a-f0-9]{32}$/.test(s("installationId"))) return null;
  if (!/^[a-f0-9]{64}$/.test(s("projectionSecret"))) return null;
  if (!/^did_[a-f0-9]{64}$/.test(s("deviceId"))) return null;
  if (!s("signingPublicKey") || !s("signingPrivateKey")) return null;
  return {
    schemaVersion: 1,
    installationId: s("installationId"),
    projectionSecret: s("projectionSecret"),
    deviceId: s("deviceId"),
    signingPublicKey: s("signingPublicKey"),
    signingPrivateKey: s("signingPrivateKey"),
    writtenAt: s("writtenAt") || new Date(0).toISOString(),
  };
}

export function parseDurableLedger(value: unknown): DurablePeerLedgerV1 | null {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.links)) return null;
  const links: DurablePeerLinkV1[] = [];
  for (const raw of value.links) {
    if (!isRecord(raw)) continue;
    if (typeof raw.linkId !== "string" || typeof raw.role !== "string" || typeof raw.peerAuthorityUrl !== "string") continue;
    const str = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : null);
    links.push({
      linkId: raw.linkId,
      role: raw.role,
      peerAuthorityUrl: raw.peerAuthorityUrl,
      peerInstallationId: str("peerInstallationId"),
      peerDeviceId: str("peerDeviceId"),
      peerOrganizationRef: str("peerOrganizationRef"),
      localOrganizationId: str("localOrganizationId"),
      displayName: str("displayName") ?? raw.linkId,
      tokenHash: str("tokenHash"),
      tokenPrefix: str("tokenPrefix"),
      peerToken: str("peerToken"),
      approvedAtLocal: str("approvedAtLocal"),
      approvedAtPeer: str("approvedAtPeer"),
      approvedByPrincipalId: str("approvedByPrincipalId"),
      enrolledAt: str("enrolledAt"),
      quarantinedAt: str("quarantinedAt"),
      quarantineReason: str("quarantineReason"),
      metadata: raw.metadata ?? null,
    });
  }
  return { schemaVersion: 1, writtenAt: typeof value.writtenAt === "string" ? value.writtenAt : new Date(0).toISOString(), links };
}

async function readJson(path: string): Promise<unknown | null> {
  try {
    return JSON.parse((await readFile(path, "utf8")).replace(/^﻿/, ""));
  } catch {
    return null;
  }
}

/** Atomic, private write: temp file + rename, mode 0600. False on any failure.
 *  The directory is never created here: the compose mount provides it, and a
 *  host without the mount (tests, ad-hoc imports) must not grow a stray folder. */
async function writeJsonPrivate(dir: string, file: string, value: unknown): Promise<boolean> {
  try {
    if (!(await stat(dir)).isDirectory()) return false;
    const target = join(dir, file);
    const temp = `${target}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
    try { await chmod(temp, 0o600); } catch { /* Windows bind mounts ignore modes */ }
    await rename(temp, target);
    return true;
  } catch {
    return false;
  }
}

export function createFileFederationStore(dir: string = federationStateDir()): DurableFederationStore {
  return {
    readIdentity: async () => parseDurableIdentity(await readJson(join(dir, IDENTITY_FILE))),
    writeIdentity: (identity) => writeJsonPrivate(dir, IDENTITY_FILE, identity),
    readLedger: async () => parseDurableLedger(await readJson(join(dir, LEDGER_FILE))),
    writeLedger: (ledger) => writeJsonPrivate(dir, LEDGER_FILE, ledger),
    available: async () => {
      try {
        const info = await stat(dir);
        if (!info.isDirectory()) return false;
        const probe = join(dir, `.probe.${process.pid}`);
        await writeFile(probe, "", { mode: 0o600 });
        await rename(probe, probe); // no-op rename proves the directory is writable
        const { rm } = await import("node:fs/promises");
        await rm(probe, { force: true });
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** In-memory store for tests and for hosts without the mount. */
export function createMemoryFederationStore(initial: {
  identity?: DurableFederationIdentityV1 | null;
  ledger?: DurablePeerLedgerV1 | null;
  available?: boolean;
} = {}): DurableFederationStore & { identity: DurableFederationIdentityV1 | null; ledger: DurablePeerLedgerV1 | null } {
  const state = {
    identity: initial.identity ?? null,
    ledger: initial.ledger ?? null,
    available: initial.available ?? true,
  };
  return {
    get identity() { return state.identity; },
    get ledger() { return state.ledger; },
    readIdentity: async () => state.identity,
    writeIdentity: async (identity) => { if (!state.available) return false; state.identity = identity; return true; },
    readLedger: async () => state.ledger,
    writeLedger: async (ledger) => { if (!state.available) return false; state.ledger = ledger; return true; },
    available: async () => state.available,
  };
}

let defaultStore: DurableFederationStore | null = null;
/** Process-wide default store (file-backed). Tests inject their own. */
export function defaultFederationStore(): DurableFederationStore {
  if (!defaultStore) defaultStore = createFileFederationStore();
  return defaultStore;
}
