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
  ensureFederationDeliveryQueue,
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
    /** Quarantine a link the peer itself is refusing (see quarantineRejectedLink). */
    updateMany?(args: unknown): Promise<{ count: number }>;
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

/**
 * Why a delivery attempt failed, in the only two shapes that should be treated
 * differently: the peer was never reached, or the peer answered and refused.
 *
 * `postToPeer` already encodes this — `status: 0` is set on BOTH the transport
 * catch and the SSRF-guard reject, and any other status is a real HTTP reply —
 * so this is a reading of existing evidence, not new plumbing.
 *
 * The distinction is load-bearing (BI observed 2026-09-15). Both kinds shared one
 * retry budget: MAX_ATTEMPTS 8 with a 30s..30m backoff exhausts in about an hour,
 * so an install that simply could not see its peer — a laptop away from the home
 * LAN for a few days — dead-lettered every queued item roughly an hour after it
 * was enqueued. Distance was being recorded as permanent failure.
 *
 * Meanwhile the opposite error was also wrong: a peer answering 401/403 is a
 * settled "no" that retrying cannot change, and that path burned 1,083 attempts
 * across the same outbox without ever quarantining the link.
 */
export type DeliveryFailureKind = "unreachable" | "rejected-auth" | "rejected-other";

export function classifyDeliveryFailure(status: number): DeliveryFailureKind {
  // postToPeer returns 0 for a network error and for a URL the SSRF guard
  // refused to dial. Neither reached the peer, so neither is evidence about it.
  if (status === 0) return "unreachable";
  if (status === 401 || status === 403) return "rejected-auth";
  return "rejected-other";
}

/**
 * Prior attempts an item must already carry before an auth rejection quarantines
 * its link. One, so a token caught mid-rotation gets exactly one retry, and a
 * standing refusal stops the outbox on the next pass rather than after hundreds.
 */
export const AUTH_REJECTION_QUARANTINE_MIN_ATTEMPTS = 1;

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

/**
 * Stop dialing a link whose peer is actively refusing us.
 *
 * `FederationLink.quarantinedAt` already exists and the drain's own selector
 * already excludes a quarantined link — but nothing ever set it. On the observed
 * install eight links had accumulated 1,083 consecutive 401/403 rejections and
 * not one was quarantined, so every cycle re-dialed peers that had already
 * settled the question. The column was a mechanism with no trigger.
 *
 * Idempotent and narrow: it only ever moves a link that is currently trusted and
 * unquarantined, so a concurrent cycle cannot double-apply it and it can never
 * resurrect or revoke anything.
 */
export async function quarantineRejectedLink(
  db: DemandDeliveryDb,
  linkId: string,
  now: Date,
): Promise<boolean> {
  if (!db.federationLink.updateMany) return false;
  const { count } = await db.federationLink.updateMany({
    where: { linkId, linkState: "trusted", quarantinedAt: null },
    data: { quarantinedAt: now },
  });
  return count > 0;
}

export async function dispatchDueDemand(db: DemandDeliveryDb, options: {
  now?: Date;
  limit?: number;
  random?: () => number;
  decryptToken?: typeof decryptPeerToken;
  send?: SendDemand;
  sendPosture?: SendPosture;
} = {}): Promise<{
  attempted: number;
  delivered: number;
  deferred: number;
  deadLettered: number;
  /** Attempts that never reached the peer — held, never aged out. */
  unreachable: number;
  /** Links quarantined this cycle because the peer itself refused us. */
  quarantinedLinks: string[];
}> {
  const now = options.now ?? new Date();
  if (!db.workItem.findMany) throw new Error("Federation delivery queue reader is unavailable.");
  // Safe rolling migration: every legacy pending mirror gets one idempotent
  // canonical queue job. Existing jobs retain their own retry clock.
  //
  // BI-5993AE7F: this bridge used to call ensureFederationDeliveryJob for EVERY
  // pending mirror on EVERY sweep, and each call re-upserted the same single
  // WorkQueue row. Against a backlog that cannot drain while the peer is offline
  // (~2,000 items) that measured ~708 writes/sec on a five-row table and ~1,800
  // txn/sec, enough to pin two cores. Two changes make it a true one-shot:
  // resolve the queue ONCE per sweep, and only bridge mirrors that do not
  // already have a job — so in steady state the loop below is empty.
  const pendingMirrors = await db.federatedRecordMirror.findMany({
    where: {
      recordType: { in: [...FEDERATION_OUTBOX_RECORD_TYPES] }, canonicalSide: "local", syncStatus: "pending",
    },
    select: { mirrorId: true },
  });
  if (pendingMirrors.length > 0) {
    const bridged = await db.workItem.findMany({
      where: {
        sourceType: "federation-demand-delivery",
        sourceId: { in: pendingMirrors.map((row) => row.mirrorId) },
      },
      select: { sourceId: true },
    });
    const haveJob = new Set(bridged.flatMap((row) => (row.sourceId ? [row.sourceId] : [])));
    const unbridged = pendingMirrors.filter((row) => !haveJob.has(row.mirrorId));
    if (unbridged.length > 0) {
      const queue = await ensureFederationDeliveryQueue(db);
      for (const row of unbridged) {
        await ensureFederationDeliveryJob(db, row.mirrorId, now, queue.id);
      }
    }
  }
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
  let unreachable = 0;
  const quarantinedLinks: string[] = [];
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
    const failureKind = classifyDeliveryFailure(result.status);

    // A peer we never reached tells us nothing about the payload, so it must not
    // spend the dead-letter budget. An install away from its peer for days holds
    // its outbox intact and drains it on return; previously the same budget
    // covered both kinds and everything queued was written off within the hour.
    if (failureKind === "unreachable") {
      unreachable++;
      await finishFederationDeliveryJob(db, {
        itemId: job.itemId,
        // The attempt is still counted — one was genuinely made — so the backoff
        // keeps widening and the row records how long the peer has been out of
        // contact. What changes is that this count can no longer reach the
        // dead-letter branch above: an unreachable peer defers forever rather
        // than aging the item out.
        attemptCount: job.attemptCount,
        outcome: "retry",
        error,
        now,
        nextAttemptAt: new Date(now.getTime() + retryDelayMs(attempts, options.random)),
      });
      continue;
    }

    // A peer answering 401/403 has settled the question; retrying cannot change
    // a credential decision. Quarantine the link so the whole outbox stops
    // dialing it, and surface ONE fault instead of thousands of identical ones.
    if (failureKind === "rejected-auth" && job.attemptCount >= AUTH_REJECTION_QUARANTINE_MIN_ATTEMPTS) {
      // Persisted state, not an in-memory tally. A cycle usually carries one item
      // per link, so counting within a single invocation would never reach a
      // threshold across cycles — the first draft of this did exactly that and
      // could not have fired. `attemptCount` is the durable record of "we have
      // already tried this at least once", so a token caught mid-rotation gets
      // its retry while a standing refusal quarantines on the next pass.
      if (await quarantineRejectedLink(db, link.linkId, now)) {
        quarantinedLinks.push(link.linkId);
      }
    }

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
  return {
    attempted: deliverableRows.length, delivered, deferred, deadLettered, unreachable,
    quarantinedLinks,
  };
}
