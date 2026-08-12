import type { DemandDigestV1 } from "@dpf/db/federated-demand-contract";

import { sendDemandDigestToPeer, type PeerPostResult } from "./client";
import { decodeDemandMirrorPayload } from "./demand-exchange";
import { decodeDemandOutboxPayload } from "./demand-delivery";
import type { FederationIdentity } from "./demand-identity";
import { decryptPeerToken } from "./outbound";
import {
  scheduleFederationDeliveryJob,
  type FederationDeliveryQueueDb,
} from "./delivery-queue";

interface DigestMirrorRow {
  mirrorId?: string;
  federationLinkId?: string;
  peerRecordRef?: string | null;
  version: bigint;
  syncStatus: string;
  rehealCount?: number;
  payload: unknown;
}

/** How many times digest reconciliation may resurrect a dead-lettered record the
 *  peer still needs. A transient/upgrade window recovers in one resurrection; a
 *  genuinely-poison record stops thrashing once it has exhausted the cap. */
export const MAX_DEMAND_REHEALS = 3;

export interface DemandDigestDb extends FederationDeliveryQueueDb {
  federationLink?: {
    findMany(args: unknown): Promise<Array<{ linkId: string; peerAuthorityUrl: string; peerTokenEnc: string | null; role: string }>>;
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
    if (Number(row.version) < record.originVersion) {
      needs.push({ originRecordRef: record.originRecordRef, reason: "stale", haveVersion: Number(row.version) });
      continue;
    }
    const payload = decodeDemandMirrorPayload(row.payload);
    if (Number(row.version) === record.originVersion && payload?.envelope.payloadDigest !== record.payloadDigest) {
      needs.push({ originRecordRef: record.originRecordRef, reason: "digest-mismatch", haveVersion: Number(row.version) });
    }
  }
  return { checked: digest.records.length, needs };
}

type SendDigest = typeof sendDemandDigestToPeer;

/** Per-cycle digest batch size. The reconciler pages through the FULL local
 *  inventory in batches of this size so a link with more than one batch of
 *  records can never be silently truncated. NOTE: full-inventory-per-cycle is
 *  O(records) bandwidth per link — acceptable at current scale; the delta/cursored
 *  and hub-topology reduction is tracked as a separate scale epic. This constant
 *  bounds memory/payload per request, not total coverage. */
export const DEMAND_DIGEST_BATCH_SIZE = 1_000;

/** Exchange per-link inventories (paged, never truncated) and repair lost
 *  delivery/ack state. */
export async function reconcileDemandDigests(
  db: DemandDigestDb,
  identity: FederationIdentity,
  options: {
    now?: Date;
    decryptToken?: typeof decryptPeerToken;
    send?: SendDigest;
    /** Override the page size (tests). Defaults to DEMAND_DIGEST_BATCH_SIZE. */
    batchSize?: number;
  } = {},
): Promise<{ linksChecked: number; requeued: number; confirmed: number; failedLinks: number }> {
  if (!db.federationLink || !db.federatedRecordMirror.update) {
    throw new Error("Demand digest reconciliation requires writable link and mirror stores.");
  }
  const now = options.now ?? new Date();
  const links = await db.federationLink.findMany({
    where: { linkState: "trusted", revokedAt: null, quarantinedAt: null },
    select: { linkId: true, peerAuthorityUrl: true, peerTokenEnc: true, role: true },
  });
  let linksChecked = 0;
  let requeued = 0;
  let confirmed = 0;
  let failedLinks = 0;
  const batchSize = Math.max(1, options.batchSize ?? DEMAND_DIGEST_BATCH_SIZE);
  for (const link of links) {
    const token = (options.decryptToken ?? decryptPeerToken)(link.peerTokenEnc);
    if (!token) {
      failedLinks++;
      continue;
    }
    // Page through the ENTIRE local inventory in bounded batches. A link with
    // more than one batch of records must never be silently truncated (the prior
    // `take: 1_000` with no cursor dropped everything past the first 1,000). Each
    // batch is a self-contained digest exchange; the peer's `checked` is compared
    // per batch. Full-inventory-per-cycle bandwidth is the known O(records) cost
    // deferred to the delta-sync/hub scale epic — correctness is fixed here.
    let cursorId: string | undefined;
    let linkOk = false;
    let linkFailed = false;
    let batches = 0;
    for (;;) {
      const rows = await db.federatedRecordMirror.findMany({
        where: { federationLinkId: link.linkId, recordType: "demand-envelope", canonicalSide: "local" },
        orderBy: { mirrorId: "asc" },
        take: batchSize,
        ...(cursorId ? { cursor: { mirrorId: cursorId }, skip: 1 } : {}),
        select: { mirrorId: true, federationLinkId: true, version: true, syncStatus: true, rehealCount: true, payload: true },
      });
      if (rows.length === 0) break;
      const lastId = rows[rows.length - 1]?.mirrorId;
      const moreLikely = rows.length === batchSize && !!lastId;
      cursorId = lastId ?? cursorId;
      batches++;

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

      if (records.length > 0) {
        const digest: DemandDigestV1 = {
          specVersion: "dpf.demand-digest/1",
          originInstallationId: identity.installationId,
          generatedAt: now.toISOString(),
          records,
        };
        const result: PeerPostResult = await (options.send ?? sendDemandDigestToPeer)(
          {
            peerAuthorityUrl: link.peerAuthorityUrl,
            linkToken: token,
            linkId: link.linkId,
            sameOrgLan: link.role === "same-org-peer",
          },
          digest,
          { now },
        );
        if (
          !result.ok || !result.body || typeof result.body !== "object" ||
          Number((result.body as { checked?: unknown }).checked) !== records.length
        ) {
          linkFailed = true;
          break;
        }
        linkOk = true;
        const needs = new Map(
          (Array.isArray((result.body as { needs?: unknown }).needs) ? (result.body as { needs: DemandDigestNeed[] }).needs : [])
            .filter((need) => need && typeof need.originRecordRef === "string")
            .map((need) => [need.originRecordRef, need]),
        );
        for (const { row, payload } of usable) {
          const need = needs.get(payload.envelope.originRecordRef);
          if (need) {
            // Dead-letter is recoverable, not terminal: if the peer still needs a
            // record we gave up on (e.g. it 422'd during the other side's upgrade
            // window and the producer bug is since fixed), resurrect it — but cap the
            // resurrections so a genuinely-poison record eventually stays dead instead
            // of re-sending on every digest cycle forever (BI-8A7E3E56).
            const wasDeadLettered = row.syncStatus === "dead-letter";
            if (wasDeadLettered && (row.rehealCount ?? 0) >= MAX_DEMAND_REHEALS) continue;
            requeued++;
            await db.federatedRecordMirror.update!({ where: { mirrorId: row.mirrorId }, data: {
              syncStatus: "pending", deadLetteredAt: null,
              ...(wasDeadLettered ? { rehealCount: (row.rehealCount ?? 0) + 1 } : {}),
            } });
            await scheduleFederationDeliveryJob(db, row.mirrorId!, now);
          } else {
            confirmed++;
            await db.federatedRecordMirror.update!({ where: { mirrorId: row.mirrorId }, data: {
              syncStatus: payload.activity === "dpf.demand.withdrawn" ? "withdrawn" : "synced",
              acknowledgedVersion: row.version, lastSyncedAt: now, deadLetteredAt: null,
            } });
          }
        }
      }

      if (!moreLikely) break;
    }
    if (linkFailed) failedLinks++;
    else if (linkOk) linksChecked++;
    if (batches > 1) {
      // Density signal: this link needed multiple digest batches, i.e. > one batch
      // of shareable records. Correctness holds (all batches processed), but this
      // is the trigger to prioritize the delta-sync/hub scale epic.
      console.warn(`[demand-digest] link ${link.linkId} reconciled in ${batches} batches (> ${batchSize} records); full-inventory digest is O(records) — track the delta-sync/hub scale epic.`);
    }
  }
  return { linksChecked, requeued, confirmed, failedLinks };
}
