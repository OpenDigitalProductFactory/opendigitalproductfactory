import type { DemandDigestV1 } from "@dpf/db/federated-demand-contract";

import { sendDemandDigestToPeer, type PeerPostResult } from "./client";
import { decodeDemandMirrorPayload } from "./demand-exchange";
import { decodeDemandOutboxPayload } from "./demand-delivery";
import type { FederationIdentity } from "./demand-identity";
import { decryptPeerToken } from "./outbound";

interface DigestMirrorRow {
  mirrorId?: string;
  federationLinkId?: string;
  peerRecordRef?: string | null;
  version: number;
  syncStatus: string;
  payload: unknown;
}

export interface DemandDigestDb {
  federationLink?: {
    findMany(args: unknown): Promise<Array<{ linkId: string; peerAuthorityUrl: string; peerTokenEnc: string | null }>>;
  };
  federatedRecordMirror: {
    findMany(args: unknown): Promise<DigestMirrorRow[]>;
    update?(args: unknown): Promise<unknown>;
  };
}

export interface DemandDigestNeed {
  originRecordRef: string;
  reason: "missing" | "stale" | "digest-mismatch";
  haveVersion?: number;
}

export async function compareIncomingDemandDigest(
  db: DemandDigestDb,
  linkId: string,
  digest: DemandDigestV1,
): Promise<{ checked: number; needs: DemandDigestNeed[] }> {
  const peerRefs = digest.records.map((record) => `${digest.originInstallationId}:${record.originRecordRef}`);
  const rows = await db.federatedRecordMirror.findMany({
    where: {
      federationLinkId: linkId, recordType: "demand-envelope", canonicalSide: "peer",
      peerRecordRef: { in: peerRefs },
    },
    select: { peerRecordRef: true, version: true, syncStatus: true, payload: true },
  });
  const byRef = new Map(rows.map((row) => [row.peerRecordRef, row]));
  const needs: DemandDigestNeed[] = [];
  for (const record of digest.records) {
    const row = byRef.get(`${digest.originInstallationId}:${record.originRecordRef}`);
    if (!row) {
      needs.push({ originRecordRef: record.originRecordRef, reason: "missing" });
      continue;
    }
    if (row.version < record.originVersion) {
      needs.push({ originRecordRef: record.originRecordRef, reason: "stale", haveVersion: row.version });
      continue;
    }
    const payload = decodeDemandMirrorPayload(row.payload);
    if (row.version === record.originVersion && payload?.envelope.payloadDigest !== record.payloadDigest) {
      needs.push({ originRecordRef: record.originRecordRef, reason: "digest-mismatch", haveVersion: row.version });
    }
  }
  return { checked: digest.records.length, needs };
}

type SendDigest = typeof sendDemandDigestToPeer;

/** Exchange bounded per-link inventories and repair lost delivery/ack state. */
export async function reconcileDemandDigests(
  db: DemandDigestDb,
  identity: FederationIdentity,
  options: {
    now?: Date;
    decryptToken?: typeof decryptPeerToken;
    send?: SendDigest;
  } = {},
): Promise<{ linksChecked: number; requeued: number; confirmed: number; failedLinks: number }> {
  if (!db.federationLink || !db.federatedRecordMirror.update) {
    throw new Error("Demand digest reconciliation requires writable link and mirror stores.");
  }
  const now = options.now ?? new Date();
  const links = await db.federationLink.findMany({
    where: { linkState: "trusted", revokedAt: null, quarantinedAt: null },
    select: { linkId: true, peerAuthorityUrl: true, peerTokenEnc: true },
  });
  let linksChecked = 0;
  let requeued = 0;
  let confirmed = 0;
  let failedLinks = 0;
  for (const link of links) {
    const rows = await db.federatedRecordMirror.findMany({
      where: { federationLinkId: link.linkId, recordType: "demand-envelope", canonicalSide: "local" },
      orderBy: { updatedAt: "asc" },
      take: 1_000,
      select: { mirrorId: true, federationLinkId: true, version: true, syncStatus: true, payload: true },
    });
    if (rows.length === 0) continue;
    const usable = rows.flatMap((row) => {
      const payload = decodeDemandOutboxPayload(row.payload);
      return payload && payload.envelope.specVersion === "dpf.demand/1" && row.mirrorId
        ? [{ row, payload: { ...payload, envelope: payload.envelope } }]
        : [];
    });
    const records = usable.map(({ payload }) => ({
      originRecordRef: payload.envelope.originRecordRef,
      originVersion: payload.envelope.originVersion,
      payloadDigest: payload.envelope.payloadDigest,
      withdrawn: payload.activity === "dpf.demand.withdrawn",
    }));
    if (records.length === 0) continue;
    const token = (options.decryptToken ?? decryptPeerToken)(link.peerTokenEnc);
    if (!token) {
      failedLinks++;
      continue;
    }
    const digest: DemandDigestV1 = {
      specVersion: "dpf.demand-digest/1",
      originInstallationId: identity.installationId,
      generatedAt: now.toISOString(),
      records,
    };
    const result: PeerPostResult = await (options.send ?? sendDemandDigestToPeer)(
      { peerAuthorityUrl: link.peerAuthorityUrl, linkToken: token, linkId: link.linkId },
      digest,
      { now },
    );
    if (!result.ok || !result.body || typeof result.body !== "object") {
      failedLinks++;
      continue;
    }
    if (Number((result.body as { checked?: unknown }).checked) !== records.length) {
      failedLinks++;
      continue;
    }
    linksChecked++;
    const needs = new Map(
      (Array.isArray((result.body as { needs?: unknown }).needs) ? (result.body as { needs: DemandDigestNeed[] }).needs : [])
        .filter((need) => need && typeof need.originRecordRef === "string")
        .map((need) => [need.originRecordRef, need]),
    );
    for (const { row, payload } of usable) {
      const need = needs.get(payload.envelope.originRecordRef);
      if (need) {
        if (row.syncStatus === "dead-letter") continue;
        requeued++;
        await db.federatedRecordMirror.update!({ where: { mirrorId: row.mirrorId }, data: {
          syncStatus: "pending", deliveryAttempts: 0, nextDeliveryAt: now,
          lastDeliveryError: `reconciliation:${need.reason}`, deadLetteredAt: null,
        } });
      } else {
        confirmed++;
        await db.federatedRecordMirror.update!({ where: { mirrorId: row.mirrorId }, data: {
          syncStatus: payload.activity === "dpf.demand.withdrawn" ? "withdrawn" : "synced",
          acknowledgedVersion: row.version, lastSyncedAt: now, nextDeliveryAt: null,
          lastDeliveryError: null, deadLetteredAt: null,
        } });
      }
    }
  }
  return { linksChecked, requeued, confirmed, failedLinks };
}
