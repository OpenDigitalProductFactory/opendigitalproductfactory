import { createHash } from "node:crypto";

import type {
  DemandActivity,
  DemandAttribution,
  DemandAudience,
  DemandEnvelopeV1,
  DemandResponseV1,
  DemandDispositionNoticeV1,
} from "@dpf/db/federated-demand-contract";
import { computeDemandPayloadDigest } from "@dpf/db/federated-demand-contract";
import type { ProjectionContractSpec } from "@dpf/db/projection-serialization";

import { sendDemandToPeer, sendOperationalPostureToPeer, type PeerPostResult } from "./client";
import { buildDemandEnvelope, type ProjectableDemandSource } from "./demand-projection";
import type { FederationIdentity } from "./demand-identity";
import { decodeOperationalPostureOutboxPayload } from "./operational-posture-delivery";
import { decryptPeerToken } from "./outbound";
import { incrementVersionVector, isVersionVector, type VersionVector } from "./version-vector";
import {
  ensureFederationDeliveryJob,
  claimFederationDeliveryJob,
  finishFederationDeliveryJob,
  scheduleFederationDeliveryJob,
  type FederationDeliveryQueueDb,
} from "./delivery-queue";

/** Parse a stored JSON version vector, defaulting to empty when absent/legacy. */
function readStoredVector(value: unknown): VersionVector {
  return isVersionVector(value) ? value : {};
}

type OutboundDemandActivity = Extract<DemandActivity, "dpf.demand.proposed" | "dpf.demand.updated" | "dpf.demand.withdrawn">;
type OutboundResponseActivity = Extract<DemandActivity, "dpf.demand.interest-recorded" | "dpf.demand.help-offered">;
type OutboundDispositionActivity = Extract<DemandActivity, "dpf.demand.dispositioned" | "dpf.release.applicability-published">;

export interface DemandOutboxPayload {
  envelope: DemandEnvelopeV1 | DemandResponseV1 | DemandDispositionNoticeV1;
  activity: OutboundDemandActivity | OutboundResponseActivity | OutboundDispositionActivity;
  eventId: string;
  queuedAt: string;
}

interface DemandOutboxRow {
  mirrorId: string;
  federationLinkId: string;
  recordType?: string;
  canonicalSide?: string;
  localRecordRef?: string | null;
  version: bigint;
  syncStatus: string;
  deliveryAttempts: number;
  payload: unknown;
}

export interface DemandDeliveryDb extends FederationDeliveryQueueDb {
  federationLink: {
    findMany(args: unknown): Promise<Array<{
      linkId: string;
      peerAuthorityUrl: string;
      peerTokenEnc: string | null;
      role: string;
    }>>;
  };
  federatedRecordMirror: {
    findUnique(args: unknown): Promise<Partial<DemandOutboxRow> & { mirrorId: string; version: bigint; syncStatus: string; payload: unknown; versionVector?: unknown } | null>;
    findMany(args: unknown): Promise<DemandOutboxRow[]>;
    create(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
  };
}

export interface DemandLinkTarget {
  linkId: string;
  peerAuthorityUrl: string;
  peerTokenEnc: string | null;
}

function localWhere(linkId: string, localRecordRef: string) {
  return { federationLinkId_recordType_localRecordRef: { federationLinkId: linkId, recordType: "demand-envelope", localRecordRef } };
}

function outboxId(linkId: string, localRecordRef: string): string {
  return `fdmo_${createHash("sha256").update(`${linkId}\u0000${localRecordRef}`).digest("hex").slice(0, 24)}`;
}

function eventId(linkId: string, envelope: DemandEnvelopeV1, activity: OutboundDemandActivity): string {
  return `fdme_${createHash("sha256")
    .update(`${linkId}\u0000${envelope.envelopeId}\u0000${envelope.originVersion}\u0000${activity}`)
    .digest("hex").slice(0, 24)}`;
}

export function decodeDemandOutboxPayload(value: unknown): DemandOutboxPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Partial<DemandOutboxPayload>;
  if (!payload.envelope || typeof payload.envelope !== "object" || typeof payload.eventId !== "string") return null;
  if (!["dpf.demand.proposed", "dpf.demand.updated", "dpf.demand.withdrawn", "dpf.demand.interest-recorded", "dpf.demand.help-offered", "dpf.demand.dispositioned", "dpf.release.applicability-published"].includes(payload.activity ?? "")) return null;
  return payload as DemandOutboxPayload;
}

export async function queueDemandProjection(db: DemandDeliveryDb, input: {
  link: DemandLinkTarget;
  source: ProjectableDemandSource;
  identity: FederationIdentity;
  contract: ProjectionContractSpec;
  audience: DemandAudience;
  attribution: DemandAttribution;
  forwarding?: DemandEnvelopeV1["forwarding"];
  now?: Date;
}): Promise<{ action: "queued" | "noop"; mirrorId: string; originVersion: number }> {
  const built = buildDemandEnvelope(input);
  if (built.violations.length > 0) throw new Error(`Demand projection refused: ${built.violations.join(", ")}`);
  const where = localWhere(input.link.linkId, input.source.localRecordRef);
  const existing = await db.federatedRecordMirror.findUnique({ where });
  const prior = decodeDemandOutboxPayload(existing?.payload);
  if (existing && prior?.envelope.payloadDigest === built.envelope.payloadDigest) {
    return { action: "noop", mirrorId: existing.mirrorId, originVersion: Number(existing.version) };
  }

  // Real content change → advance THIS installation's counter in the causal vector,
  // carried forward from the record's prior vector. Set after the noop check and
  // (harmlessly) after digest computation, since the vector is digest-excluded.
  const versionVector = incrementVersionVector(
    readStoredVector(existing?.versionVector),
    input.identity.installationId,
  );
  built.envelope.versionVector = versionVector;

  const activity: OutboundDemandActivity = existing ? "dpf.demand.updated" : "dpf.demand.proposed";
  const payload: DemandOutboxPayload = {
    envelope: built.envelope,
    activity,
    eventId: eventId(input.link.linkId, built.envelope, activity),
    queuedAt: (input.now ?? new Date()).toISOString(),
  };
  const data = {
    syncStatus: "pending",
    version: built.envelope.originVersion,
    versionVector,
    payload,
    deadLetteredAt: null,
  };
  if (existing) {
    await db.federatedRecordMirror.update({ where: { mirrorId: existing.mirrorId }, data });
    await scheduleFederationDeliveryJob(db, existing.mirrorId, input.now ?? new Date());
    return { action: "queued", mirrorId: existing.mirrorId, originVersion: built.envelope.originVersion };
  }
  const mirrorId = outboxId(input.link.linkId, input.source.localRecordRef);
  await db.federatedRecordMirror.create({ data: {
    mirrorId,
    federationLinkId: input.link.linkId,
    recordType: "demand-envelope",
    canonicalSide: "local",
    localRecordRef: input.source.localRecordRef,
    peerRecordRef: null,
    ...data,
  } });
  await scheduleFederationDeliveryJob(db, mirrorId, input.now ?? new Date());
  return { action: "queued", mirrorId, originVersion: built.envelope.originVersion };
}

/** Queue an already-minimized, consent-validated forwarded envelope without
 * rewriting its origin. The local mirror ref is an internal routing key only. */
export async function queueForwardedDemand(db: DemandDeliveryDb, input: {
  link: DemandLinkTarget;
  localMirrorRef: string;
  envelope: DemandEnvelopeV1;
  now?: Date;
}): Promise<{ action: "queued" | "noop"; mirrorId: string; originVersion: number }> {
  const localRecordRef = `forward:${input.localMirrorRef}`;
  const where = localWhere(input.link.linkId, localRecordRef);
  const existing = await db.federatedRecordMirror.findUnique({ where });
  const prior = decodeDemandOutboxPayload(existing?.payload);
  if (existing && prior?.envelope.payloadDigest === input.envelope.payloadDigest) {
    return { action: "noop", mirrorId: existing.mirrorId, originVersion: Number(existing.version) };
  }
  const activity: OutboundDemandActivity = existing ? "dpf.demand.updated" : "dpf.demand.proposed";
  const payload: DemandOutboxPayload = {
    envelope: input.envelope,
    activity,
    eventId: eventId(input.link.linkId, input.envelope, activity),
    queuedAt: (input.now ?? new Date()).toISOString(),
  };
  const data = {
    syncStatus: "pending",
    version: input.envelope.originVersion,
    payload,
    deadLetteredAt: null,
  };
  if (existing) {
    await db.federatedRecordMirror.update({ where: { mirrorId: existing.mirrorId }, data });
    await scheduleFederationDeliveryJob(db, existing.mirrorId, input.now ?? new Date());
    return { action: "queued", mirrorId: existing.mirrorId, originVersion: input.envelope.originVersion };
  }
  const mirrorId = outboxId(input.link.linkId, localRecordRef);
  await db.federatedRecordMirror.create({ data: {
    mirrorId,
    federationLinkId: input.link.linkId,
    recordType: "demand-envelope",
    canonicalSide: "local",
    localRecordRef,
    peerRecordRef: null,
    ...data,
  } });
  await scheduleFederationDeliveryJob(db, mirrorId, input.now ?? new Date());
  return { action: "queued", mirrorId, originVersion: input.envelope.originVersion };
}

export async function queueDemandWithdrawal(
  db: DemandDeliveryDb,
  linkId: string,
  localRecordRef: string,
  now = new Date(),
): Promise<{ action: "queued" | "noop"; activity: "dpf.demand.withdrawn"; mirrorId: string }> {
  const existing = await db.federatedRecordMirror.findUnique({ where: localWhere(linkId, localRecordRef) });
  if (!existing) return { action: "noop", activity: "dpf.demand.withdrawn", mirrorId: "" };
  const prior = decodeDemandOutboxPayload(existing.payload);
  if (!prior || prior.envelope.specVersion !== "dpf.demand/1") throw new Error("Stored demand outbox payload is invalid.");
  if (prior.activity === "dpf.demand.withdrawn" && existing.syncStatus === "synced") {
    return { action: "noop", activity: "dpf.demand.withdrawn", mirrorId: existing.mirrorId };
  }
  const envelope: DemandEnvelopeV1 = {
    ...prior.envelope,
    originVersion: Math.max(Number(existing.version) + 1, now.getTime()),
    updatedAt: now.toISOString(),
    payloadDigest: "sha256:pending",
  };
  envelope.payloadDigest = computeDemandPayloadDigest(envelope);
  const activity = "dpf.demand.withdrawn" as const;
  await db.federatedRecordMirror.update({
    where: { mirrorId: existing.mirrorId },
    data: {
      syncStatus: "pending", version: envelope.originVersion,
      payload: { envelope, activity, eventId: eventId(linkId, envelope, activity), queuedAt: now.toISOString() },
      deadLetteredAt: null,
    },
  });
  await scheduleFederationDeliveryJob(db, existing.mirrorId, now);
  return { action: "queued", activity, mirrorId: existing.mirrorId };
}

const BASE_RETRY_MS = 30_000;
const MAX_RETRY_MS = 30 * 60_000;
const MAX_ATTEMPTS = 8;

export function retryDelayMs(attempt: number, random: () => number = Math.random): number {
  const bounded = Math.min(MAX_RETRY_MS, BASE_RETRY_MS * 2 ** Math.max(0, attempt - 1));
  return Math.round(bounded * (0.5 + random()));
}

type SendDemand = typeof sendDemandToPeer;
type SendPosture = typeof sendOperationalPostureToPeer;

/** Every local-canonical record type that rides the shared federation outbox. */
export const FEDERATION_OUTBOX_RECORD_TYPES = [
  "demand-envelope", "demand-response", "demand-disposition", "operational-posture",
] as const;

export async function dispatchDueDemand(db: DemandDeliveryDb, options: {
  now?: Date;
  limit?: number;
  random?: () => number;
  decryptToken?: typeof decryptPeerToken;
  send?: SendDemand;
  sendPosture?: SendPosture;
} = {}): Promise<{ attempted: number; delivered: number; deferred: number; deadLettered: number }> {
  const now = options.now ?? new Date();
  // Safe rolling migration: every legacy pending mirror gets one idempotent
  // canonical queue job. Existing jobs retain their own retry clock.
  const pendingMirrors = await db.federatedRecordMirror.findMany({
    where: {
      recordType: { in: [...FEDERATION_OUTBOX_RECORD_TYPES] }, canonicalSide: "local", syncStatus: "pending",
    },
    select: { mirrorId: true },
  });
  for (const row of pendingMirrors) await ensureFederationDeliveryJob(db, row.mirrorId, now);
  if (!db.workItem.findMany) throw new Error("Federation delivery queue reader is unavailable.");
  const jobs = await db.workItem.findMany({
    where: {
      sourceType: "federation-demand-delivery",
      OR: [
        { status: "queued", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
        { status: "in-progress", lastAttemptAt: { lte: new Date(now.getTime() - 5 * 60_000) } },
      ],
    },
    orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
    take: options.limit ?? 50,
    select: { itemId: true, sourceId: true, attemptCount: true, createdAt: true, claimedAt: true },
  });
  const mirrorIds = jobs.flatMap((job) => job.sourceId ? [job.sourceId] : []);
  const rows = mirrorIds.length === 0 ? [] : await db.federatedRecordMirror.findMany({
    where: { mirrorId: { in: mirrorIds }, canonicalSide: "local", syncStatus: "pending" },
  });
  const jobByMirrorId = new Map(jobs.flatMap((job) => job.sourceId ? [[job.sourceId, job] as const] : []));
  const links = await db.federationLink.findMany({
    where: {
      linkId: { in: [...new Set(rows.map((row) => row.federationLinkId))] },
      linkState: "trusted", revokedAt: null, quarantinedAt: null,
    },
    select: { linkId: true, peerAuthorityUrl: true, peerTokenEnc: true, role: true },
  });
  const linkById = new Map(links.map((link) => [link.linkId, link]));
  const deliverableRows = rows.filter((row) => linkById.has(row.federationLinkId));
  let delivered = 0;
  let deferred = 0;
  let deadLettered = 0;
  for (const row of deliverableRows) {
    const job = jobByMirrorId.get(row.mirrorId);
    if (!job) continue;
    if (!await claimFederationDeliveryJob(db, job.itemId, now)) continue;
    const link = linkById.get(row.federationLinkId)!;
    const target = {
      peerAuthorityUrl: link.peerAuthorityUrl,
      linkToken: "",
      linkId: link.linkId,
      sameOrgLan: link.role === "same-org-peer",
    };
    const token = (options.decryptToken ?? decryptPeerToken)(link.peerTokenEnc);
    let result: PeerPostResult;
    let payload: DemandOutboxPayload | null = null;
    let acknowledged = false;
    if (row.recordType === "operational-posture") {
      // A posture report rides the same outbox and retry clock as demand; only
      // the payload shape, the send helper and the acknowledgment differ.
      const posture = decodeOperationalPostureOutboxPayload(row.payload);
      if (!posture) result = { ok: false, status: 0, error: "invalid outbox payload" };
      else if (!token) result = { ok: false, status: 0, error: "missing peer token" };
      else result = await (options.sendPosture ?? sendOperationalPostureToPeer)(
        { ...target, linkToken: token },
        posture.activity,
        posture.record,
        { eventId: posture.eventId, now },
      );
      acknowledged = result.ok
        && typeof result.body === "object" && result.body !== null
        && Number((result.body as { originVersion?: unknown }).originVersion) === Number(row.version);
    } else {
      payload = decodeDemandOutboxPayload(row.payload);
      if (!payload) result = { ok: false, status: 0, error: "invalid outbox payload" };
      else if (!token) result = { ok: false, status: 0, error: "missing peer token" };
      else result = await (options.send ?? sendDemandToPeer)(
        { ...target, linkToken: token },
        payload.activity,
        payload.envelope,
        { eventId: payload.eventId, now },
      );

      const responseId = payload?.envelope.specVersion === "dpf.demand-response/1"
        ? payload.envelope.responseId
        : null;
      const noticeId = payload?.envelope.specVersion === "dpf.demand-disposition/1"
        ? payload.envelope.noticeId
        : null;
      acknowledged = result.ok
        && typeof result.body === "object" && result.body !== null
        && (noticeId
          ? (result.body as { noticeId?: unknown }).noticeId === noticeId
          : responseId
          ? (result.body as { responseId?: unknown }).responseId === responseId
          : Number((result.body as { originVersion?: unknown }).originVersion) === Number(row.version));
    }
    if (acknowledged) {
      delivered++;
      await db.federatedRecordMirror.update({ where: { mirrorId: row.mirrorId }, data: {
        syncStatus: payload?.activity === "dpf.demand.withdrawn" ? "withdrawn" : "synced",
        acknowledgedVersion: row.version, lastSyncedAt: now,
        deadLetteredAt: null, rehealCount: 0,
      } });
      await finishFederationDeliveryJob(db, { itemId: job.itemId, attemptCount: job.attemptCount, outcome: "success", now });
      continue;
    }

    const attempts = job.attemptCount + 1;
    const error = (result.error ?? `peer responded ${result.status}`).slice(0, 1_000);
    if (attempts >= MAX_ATTEMPTS) {
      deadLettered++;
      await db.federatedRecordMirror.update({ where: { mirrorId: row.mirrorId }, data: {
        syncStatus: "dead-letter", deadLetteredAt: now,
      } });
      await finishFederationDeliveryJob(db, { itemId: job.itemId, attemptCount: job.attemptCount, outcome: "dead-letter", error, now });
    } else {
      deferred++;
      await finishFederationDeliveryJob(db, {
        itemId: job.itemId,
        attemptCount: job.attemptCount,
        outcome: "retry",
        error,
        now,
        nextAttemptAt: new Date(now.getTime() + retryDelayMs(attempts, options.random)),
      });
    }
  }
  return { attempted: deliverableRows.length, delivered, deferred, deadLettered };
}
