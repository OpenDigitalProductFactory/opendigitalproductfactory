// EP-ZERO-CONFIG-FEDERATION §5.2 — the peer ledger.
//
// Every non-revoked federation link is mirrored into the state directory with
// the material a fresh database needs to recreate it: the inbound token HASH
// (that is all inbound auth ever checks), the peer-issued token in clear (we
// must replay it), the approvals, and the peer's identity facts. At boot the
// ledger is absorbed: a link the database does not know is recreated exactly,
// so a reinstalled member keeps every peer it had without either side doing a
// thing. Absorption never overwrites a link the database already holds.
//
// DB-injected so the policy runs under unit test with a mock store.

import { prisma } from "@dpf/db";
import {
  FEDERATION_PEER_ALIAS_TYPE,
  FEDERATION_PEER_PRINCIPAL_KIND,
  linkStateFromRow,
} from "@dpf/db/federation-link-types";

import { decryptSecret, encryptSecret } from "@/lib/govern/credential-crypto";
import { getErrorMessage } from "@/lib/shared/get-error-message";

import {
  defaultFederationStore,
  type DurableFederationStore,
  type DurablePeerLedgerV1,
  type DurablePeerLinkV1,
} from "./durable-state";

export interface LedgerLinkRow {
  linkId: string;
  role: string;
  peerAuthorityUrl: string;
  peerInstallationId: string | null;
  peerDeviceId: string | null;
  peerOrganizationRef: string | null;
  localOrganizationId: string | null;
  tokenHash: string | null;
  tokenPrefix: string | null;
  peerTokenEnc: string | null;
  approvedAtLocal: Date | null;
  approvedAtPeer: Date | null;
  approvedByPrincipalId: string | null;
  enrolledAt: Date | null;
  quarantinedAt: Date | null;
  quarantineReason: string | null;
  revokedAt: Date | null;
  metadata: unknown;
  principal: { displayName: string } | null;
}

export interface PeerLedgerDb {
  federationLink: {
    findMany(args: unknown): Promise<LedgerLinkRow[]>;
    findUnique(args: unknown): Promise<{ linkId: string } | null>;
  };
  $transaction<T>(fn: (tx: PeerLedgerTx) => Promise<T>): Promise<T>;
}

export interface PeerLedgerTx {
  principal: { create(args: unknown): Promise<{ id: string }> };
  principalAlias: { create(args: unknown): Promise<unknown> };
  federationLink: { create(args: unknown): Promise<unknown> };
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toLedgerLink(row: LedgerLinkRow, decrypt: (v: string) => string | null = decryptSecret): DurablePeerLinkV1 {
  return {
    linkId: row.linkId,
    role: row.role,
    peerAuthorityUrl: row.peerAuthorityUrl,
    peerInstallationId: row.peerInstallationId,
    peerDeviceId: row.peerDeviceId,
    peerOrganizationRef: row.peerOrganizationRef,
    localOrganizationId: row.localOrganizationId,
    displayName: row.principal?.displayName ?? row.linkId,
    tokenHash: row.tokenHash,
    tokenPrefix: row.tokenPrefix,
    peerToken: row.peerTokenEnc ? decrypt(row.peerTokenEnc) : null,
    approvedAtLocal: iso(row.approvedAtLocal),
    approvedAtPeer: iso(row.approvedAtPeer),
    approvedByPrincipalId: row.approvedByPrincipalId,
    enrolledAt: iso(row.enrolledAt),
    quarantinedAt: iso(row.quarantinedAt),
    quarantineReason: row.quarantineReason,
    metadata: row.metadata ?? null,
  };
}

/** Write every non-revoked link to the ledger. Returns false when the directory is unavailable. */
export async function syncPeerLedgerFromDb(
  db: PeerLedgerDb = prisma as unknown as PeerLedgerDb,
  deps: { store?: DurableFederationStore; decrypt?: (v: string) => string | null; now?: Date } = {},
): Promise<{ written: boolean; links: number }> {
  const store = deps.store ?? defaultFederationStore();
  const rows = await db.federationLink.findMany({
    where: { revokedAt: null },
    select: {
      linkId: true, role: true, peerAuthorityUrl: true, peerInstallationId: true, peerDeviceId: true,
      peerOrganizationRef: true, localOrganizationId: true, tokenHash: true, tokenPrefix: true,
      peerTokenEnc: true, approvedAtLocal: true, approvedAtPeer: true, approvedByPrincipalId: true,
      enrolledAt: true, quarantinedAt: true, quarantineReason: true, revokedAt: true, metadata: true,
      principal: { select: { displayName: true } },
    },
    orderBy: { enrolledAt: "asc" },
  });
  const ledger: DurablePeerLedgerV1 = {
    schemaVersion: 1,
    writtenAt: (deps.now ?? new Date()).toISOString(),
    links: rows.map((row) => toLedgerLink(row, deps.decrypt)),
  };
  let written = false;
  try {
    written = await store.writeLedger(ledger);
  } catch {
    written = false;
  }
  return { written, links: ledger.links.length };
}

/** Recreate every ledger link the database does not hold. Idempotent. */
export async function absorbPeerLedgerIntoDb(
  db: PeerLedgerDb = prisma as unknown as PeerLedgerDb,
  deps: { store?: DurableFederationStore; encrypt?: (v: string) => string; now?: Date } = {},
): Promise<{ absorbed: string[]; skipped: number; failed: string[] }> {
  const store = deps.store ?? defaultFederationStore();
  const encrypt = deps.encrypt ?? encryptSecret;
  let ledger: DurablePeerLedgerV1 | null = null;
  try {
    ledger = await store.readLedger();
  } catch {
    ledger = null;
  }
  const absorbed: string[] = [];
  const failed: string[] = [];
  let skipped = 0;
  if (!ledger) return { absorbed, skipped, failed };

  for (const entry of ledger.links) {
    const existing = await db.federationLink.findUnique({ where: { linkId: entry.linkId }, select: { linkId: true } });
    if (existing) {
      skipped++;
      continue;
    }
    const approvedAtLocal = entry.approvedAtLocal ? new Date(entry.approvedAtLocal) : null;
    const approvedAtPeer = entry.approvedAtPeer ? new Date(entry.approvedAtPeer) : null;
    const quarantinedAt = entry.quarantinedAt ? new Date(entry.quarantinedAt) : null;
    const linkState = linkStateFromRow({ approvedAtLocal, approvedAtPeer, quarantinedAt, revokedAt: null });
    try {
      await db.$transaction(async (tx) => {
        const principal = await tx.principal.create({
          data: {
            principalId: `principal_${entry.linkId}`,
            kind: FEDERATION_PEER_PRINCIPAL_KIND,
            displayName: entry.displayName,
          },
        });
        await tx.principalAlias.create({
          data: { principalId: principal.id, aliasType: FEDERATION_PEER_ALIAS_TYPE, aliasValue: entry.linkId },
        });
        await tx.federationLink.create({
          data: {
            linkId: entry.linkId,
            principalId: principal.id,
            role: entry.role,
            peerAuthorityUrl: entry.peerAuthorityUrl,
            peerInstallationId: entry.peerInstallationId,
            peerDeviceId: entry.peerDeviceId,
            peerOrganizationRef: entry.peerOrganizationRef,
            localOrganizationId: entry.localOrganizationId,
            linkState,
            tokenHash: entry.tokenHash,
            tokenPrefix: entry.tokenPrefix,
            tokenRotatedAt: entry.enrolledAt ? new Date(entry.enrolledAt) : deps.now ?? new Date(),
            peerTokenEnc: entry.peerToken ? encrypt(entry.peerToken) : null,
            approvedAtLocal,
            approvedAtPeer,
            approvedByPrincipalId: entry.approvedByPrincipalId,
            quarantinedAt,
            quarantineReason: entry.quarantineReason,
            enrolledAt: entry.enrolledAt ? new Date(entry.enrolledAt) : deps.now ?? new Date(),
            metadata: (entry.metadata ?? {}) as never,
          },
        });
      });
      absorbed.push(entry.linkId);
    } catch (error) {
      failed.push(entry.linkId);
      console.warn(`[peer-ledger] could not absorb link ${entry.linkId}: ${getErrorMessage(error)}`);
    }
  }
  return { absorbed, skipped, failed };
}
