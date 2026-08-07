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

import { sendDemandToPeer, type PeerPostResult } from "./client";
import { buildDemandEnvelope, type ProjectableDemandSource } from "./demand-projection";
import type { FederationIdentity } from "./demand-identity";
import { decryptPeerToken } from "./outbound";

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
  canonicalSide?: string;
  version: bigint;
  syncStatus: string;
  deliveryAttempts: number;
  payload: unknown;
}

export interface DemandDeliveryDb {
  federationLink: {
    findMany(args: unknown): Promise<Array<{
      linkId: string;
      peerAuthorityUrl: string;
      peerTokenEnc: string | null;
      role: string;
    }>>;
  };
  federatedRecordMirror: {
    findUnique(args: unknown): Promise<Partial<DemandOutboxRow> & { mirrorId: string; version: bigint; syncStatus: string; payload: unknown } | null>;
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
    payload,
    deliveryAttempts: 0,
    nextDeliveryAt: input.now ?? new Date(),
    lastDeliveryError: null,
    deadLetteredAt: null,
  };
  if (existing) {
    await db.federatedRecordMirror.update({ where: { mirrorId: existing.mirrorId }, data });
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
    deliveryAttempts: 0,
    nextDeliveryAt: input.now ?? new Date(),
    lastDeliveryError: null,
    deadLetteredAt: null,
  };
  if (existing) {
    await db.federatedRecordMirror.update({ where: { mirrorId: existing.mirrorId }, data });
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
      deliveryAttempts: 0, nextDeliveryAt: now, lastDeliveryError: null, deadLetteredAt: null,
    },
  });
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

export async function dispatchDueDemand(db: DemandDeliveryDb, options: {
  now?: Date;
  limit?: number;
  random?: () => number;
  decryptToken?: typeof decryptPeerToken;
  send?: SendDemand;
} = {}): Promise<{ attempted: number; delivered: number; deferred: number; deadLettered: number }> {
  const now = options.now ?? new Date();
  const rows = await db.federatedRecordMirror.findMany({
    where: {
      recordType: { in: ["demand-envelope", "demand-response", "demand-disposition"] }, canonicalSide: "local", syncStatus: "pending",
      OR: [{ nextDeliveryAt: null }, { nextDeliveryAt: { lte: now } }],
    },
    orderBy: [{ nextDeliveryAt: "asc" }, { updatedAt: "asc" }],
    take: options.limit ?? 50,
  });
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
    const link = linkById.get(row.federationLinkId)!;
    const payload = decodeDemandOutboxPayload(row.payload);
    const token = (options.decryptToken ?? decryptPeerToken)(link.peerTokenEnc);
    let result: PeerPostResult;
    if (!payload) result = { ok: false, status: 0, error: "invalid outbox payload" };
    else if (!token) result = { ok: false, status: 0, error: "missing peer token" };
    else result = await (options.send ?? sendDemandToPeer)(
      {
        peerAuthorityUrl: link.peerAuthorityUrl,
        linkToken: token,
        linkId: link.linkId,
        sameOrgLan: link.role === "same-org-peer",
      },
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
    const acknowledged = result.ok
      && typeof result.body === "object" && result.body !== null
      && (noticeId
        ? (result.body as { noticeId?: unknown }).noticeId === noticeId
        : responseId
        ? (result.body as { responseId?: unknown }).responseId === responseId
        : Number((result.body as { originVersion?: unknown }).originVersion) === Number(row.version));
    if (acknowledged) {
      delivered++;
      await db.federatedRecordMirror.update({ where: { mirrorId: row.mirrorId }, data: {
        syncStatus: payload?.activity === "dpf.demand.withdrawn" ? "withdrawn" : "synced",
        acknowledgedVersion: row.version, deliveryAttempts: row.deliveryAttempts + 1,
        lastDeliveryAt: now, lastSyncedAt: now, nextDeliveryAt: null,
        lastDeliveryError: null, deadLetteredAt: null,
      } });
      continue;
    }

    const attempts = row.deliveryAttempts + 1;
    const error = (result.error ?? `peer responded ${result.status}`).slice(0, 1_000);
    if (attempts >= MAX_ATTEMPTS) {
      deadLettered++;
      await db.federatedRecordMirror.update({ where: { mirrorId: row.mirrorId }, data: {
        syncStatus: "dead-letter", deliveryAttempts: attempts, lastDeliveryAt: now,
        lastDeliveryError: error, nextDeliveryAt: null, deadLetteredAt: now,
      } });
    } else {
      deferred++;
      await db.federatedRecordMirror.update({ where: { mirrorId: row.mirrorId }, data: {
        syncStatus: "pending", deliveryAttempts: attempts, lastDeliveryAt: now,
        lastDeliveryError: error,
        nextDeliveryAt: new Date(now.getTime() + retryDelayMs(attempts, options.random)),
      } });
    }
  }
  return { attempted: deliverableRows.length, delivered, deferred, deadLettered };
}
