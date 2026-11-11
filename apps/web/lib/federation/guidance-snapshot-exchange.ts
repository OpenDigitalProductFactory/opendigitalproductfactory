// Guidance snapshot exchange (BI-1B165D02; companion design §3.1, §4.1–4.3).
//
// Authority side: one local-canonical outbox row per companion (recordType
// "guidance-snapshot"), drained by the shared federation delivery queue exactly
// like a deployment declaration. A snapshot is re-issued when the guidance
// changes or after half its lifetime, so a reachable companion never runs into
// expiry.
//
// Companion side: the snapshot is verified against the authority DID on the
// trusted link, then held as a peer-canonical mirror. A refused snapshot never
// replaces the one held (AC-PAC-02).

import { createHash } from "node:crypto";

import {
  GUIDANCE_SNAPSHOT_ACTIVITIES,
  GUIDANCE_SNAPSHOT_LIFETIME_MS,
  GUIDANCE_SNAPSHOT_RECORD_TYPE,
  guidanceSnapshotContentDigest,
  type GuidanceSnapshotActivity,
  type GuidanceSnapshotV1,
  type GuidanceWwwdV1,
} from "@dpf/db/guidance-snapshot-contract";

import type { DemandDeliveryDb, DemandLinkTarget } from "./demand-delivery";
import type { FederationSigningIdentity } from "./demand-identity";
import { scheduleFederationDeliveryJob } from "./delivery-queue";
import { issueGuidanceSnapshot, verifyGuidanceSnapshot, type GuidanceSnapshotRefusal } from "./guidance-snapshot";

const ACTIVITY: GuidanceSnapshotActivity = "dpf.guidance-snapshot.published";

/** One snapshot per companion; the ref names the companion it was issued for. */
export function guidanceSnapshotRef(companionInstallationDid: string): string {
  return `guidance:${companionInstallationDid}`;
}

// ─── Authority side: the outbox ──────────────────────────────────────────────

export interface GuidanceSnapshotOutboxPayload {
  record: GuidanceSnapshotV1;
  activity: GuidanceSnapshotActivity;
  eventId: string;
  queuedAt: string;
}

export function decodeGuidanceSnapshotOutboxPayload(value: unknown): GuidanceSnapshotOutboxPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Partial<GuidanceSnapshotOutboxPayload>;
  if (!payload.record || typeof payload.record !== "object" || typeof payload.eventId !== "string") return null;
  if (!(GUIDANCE_SNAPSHOT_ACTIVITIES as readonly string[]).includes(payload.activity ?? "")) return null;
  return payload as GuidanceSnapshotOutboxPayload;
}

function outboxId(linkId: string, ref: string): string {
  return `fgso_${createHash("sha256").update(`${linkId}\x00${ref}`).digest("hex").slice(0, 24)}`;
}

export async function queueGuidanceSnapshot(db: DemandDeliveryDb, input: {
  link: DemandLinkTarget;
  authority: FederationSigningIdentity;
  companionInstallationDid: string;
  wwwd: GuidanceWwwdV1;
  now: Date;
  lifetimeMs?: number;
}): Promise<{ action: "queued" | "noop"; mirrorId: string; version: number }> {
  const lifetimeMs = input.lifetimeMs ?? GUIDANCE_SNAPSHOT_LIFETIME_MS;
  const ref = guidanceSnapshotRef(input.companionInstallationDid);
  const where = {
    federationLinkId_recordType_localRecordRef: {
      federationLinkId: input.link.linkId, recordType: GUIDANCE_SNAPSHOT_RECORD_TYPE, localRecordRef: ref,
    },
  };
  const existing = await db.federatedRecordMirror.findUnique({ where });
  const prior = decodeGuidanceSnapshotOutboxPayload(existing?.payload)?.record;
  if (existing && prior) {
    const unchanged = guidanceSnapshotContentDigest(prior.wwwd) === guidanceSnapshotContentDigest(input.wwwd);
    const age = input.now.getTime() - Date.parse(prior.meta.issuedAt);
    // Unchanged and within half its life: nothing to send. A pending row keeps
    // its own retry clock; a dead-lettered one is re-queued once it ages.
    if (unchanged && age < lifetimeMs / 2 && existing.syncStatus !== "dead-letter") {
      return { action: "noop", mirrorId: existing.mirrorId, version: Number(existing.version) };
    }
  }

  // The version is the issue time, advanced past anything issued before so a
  // clock that did not move still produces a newer snapshot.
  const version = Math.max(input.now.getTime(), existing ? Number(existing.version) + 1 : 0);
  const record = issueGuidanceSnapshot({
    authority: input.authority,
    companionInstallationDid: input.companionInstallationDid,
    wwwd: input.wwwd,
    version,
    now: input.now,
    lifetimeMs,
  });
  const payload: GuidanceSnapshotOutboxPayload = {
    record,
    activity: ACTIVITY,
    eventId: `fgse_${createHash("sha256").update(`${input.link.linkId}\x00${ref}\x00${version}`).digest("hex").slice(0, 24)}`,
    queuedAt: input.now.toISOString(),
  };
  const data = { syncStatus: "pending", version, payload, deadLetteredAt: null };
  if (existing) {
    await db.federatedRecordMirror.update({ where: { mirrorId: existing.mirrorId }, data });
    await scheduleFederationDeliveryJob(db, existing.mirrorId, input.now);
    return { action: "queued", mirrorId: existing.mirrorId, version };
  }
  const mirrorId = outboxId(input.link.linkId, ref);
  await db.federatedRecordMirror.create({ data: {
    mirrorId,
    federationLinkId: input.link.linkId,
    recordType: GUIDANCE_SNAPSHOT_RECORD_TYPE,
    canonicalSide: "local",
    localRecordRef: ref,
    peerRecordRef: null,
    ...data,
  } });
  await scheduleFederationDeliveryJob(db, mirrorId, input.now);
  return { action: "queued", mirrorId, version };
}

// ─── Companion side: receipt and the held snapshot ───────────────────────────

export interface GuidanceSnapshotExchangeDb {
  federationLink: {
    findUnique(args: unknown): Promise<{
      linkId: string;
      role: string;
      linkState: string;
      revokedAt: Date | null;
      peerDeviceId: string | null;
      peerEnvironmentClass: string | null;
    } | null>;
  };
  federatedRecordMirror: {
    findUnique(args: unknown): Promise<{ mirrorId: string; version: bigint; payload: unknown } | null>;
    upsert(args: unknown): Promise<unknown>;
  };
}

export type GuidanceSnapshotReceipt =
  | { action: "created" | "updated" | "noop"; originVersion: number }
  | { action: "refused"; reason: "link-not-authority" }
  | { action: "rejected"; reason: GuidanceSnapshotRefusal; violations?: string[] }
  | { action: "conflict"; reason: "version-not-advancing"; originVersion: number };

function peerWhere(linkId: string, ref: string) {
  return {
    federationLinkId_recordType_peerRecordRef: {
      federationLinkId: linkId, recordType: GUIDANCE_SNAPSHOT_RECORD_TYPE, peerRecordRef: ref,
    },
  };
}

/**
 * Accept a snapshot only from a trusted same-organization link whose peer the
 * organization CA attested as production (BI-0716C8A8), signed by that peer's
 * installation key, issued for this installation, unexpired and newer than the
 * one held.
 */
export async function handleIncomingGuidanceSnapshot(
  db: GuidanceSnapshotExchangeDb,
  linkId: string,
  record: unknown,
  context: { selfInstallationDid: string; now: Date },
): Promise<GuidanceSnapshotReceipt> {
  const link = await db.federationLink.findUnique({
    where: { linkId },
    select: { linkId: true, role: true, linkState: true, revokedAt: true, peerDeviceId: true, peerEnvironmentClass: true },
  });
  if (!link || link.role !== "same-org-peer" || link.linkState !== "trusted" || link.revokedAt
    || link.peerEnvironmentClass !== "production" || !link.peerDeviceId) {
    return { action: "refused", reason: "link-not-authority" };
  }

  const ref = guidanceSnapshotRef(context.selfInstallationDid);
  const held = await db.federatedRecordMirror.findUnique({ where: peerWhere(linkId, ref) });
  const heldRecord = held?.payload as GuidanceSnapshotV1 | undefined;
  const incoming = record as Partial<GuidanceSnapshotV1> | null;
  // An exact replay of the held snapshot is acknowledged, not refused, so a lost
  // acknowledgment does not keep the authority's outbox retrying.
  if (held && heldRecord && incoming?.signature === heldRecord.signature
    && incoming?.meta?.version === Number(held.version)) {
    return { action: "noop", originVersion: Number(held.version) };
  }

  const verified = verifyGuidanceSnapshot(record, {
    expectedAuthorityDid: link.peerDeviceId,
    selfInstallationDid: context.selfInstallationDid,
    heldVersion: held ? Number(held.version) : null,
    now: context.now,
  });
  if (!verified.ok) {
    if (verified.reason === "version-not-advancing" && held) {
      return { action: "conflict", reason: "version-not-advancing", originVersion: Number(held.version) };
    }
    return { action: "rejected", reason: verified.reason, ...(verified.violations ? { violations: verified.violations } : {}) };
  }

  const snapshot = verified.snapshot;
  const data = {
    version: snapshot.meta.version,
    payload: snapshot as unknown as object,
    syncStatus: "synced",
    lastSyncedAt: context.now,
  };
  await db.federatedRecordMirror.upsert({
    where: peerWhere(linkId, ref),
    create: {
      mirrorId: `fgsi_${createHash("sha256").update(`${linkId}\x00${ref}`).digest("hex").slice(0, 24)}`,
      federationLinkId: linkId,
      recordType: GUIDANCE_SNAPSHOT_RECORD_TYPE,
      canonicalSide: "peer",
      localRecordRef: null,
      peerRecordRef: ref,
      ...data,
    },
    update: data,
  });
  return { action: held ? "updated" : "created", originVersion: snapshot.meta.version };
}

/**
 * The snapshot this companion holds from the authority on `linkId`, re-verified
 * against that link's DID so a row altered at rest is never used. Expiry is left
 * to the caller, which reports an expired snapshot rather than ignoring it.
 */
export async function readHeldGuidanceSnapshot(
  db: GuidanceSnapshotExchangeDb,
  input: { linkId: string; selfInstallationDid: string },
): Promise<GuidanceSnapshotV1 | null> {
  const link = await db.federationLink.findUnique({
    where: { linkId: input.linkId },
    select: { linkId: true, role: true, linkState: true, revokedAt: true, peerDeviceId: true, peerEnvironmentClass: true },
  });
  if (!link?.peerDeviceId || link.peerEnvironmentClass !== "production") return null;
  const held = await db.federatedRecordMirror.findUnique({
    where: peerWhere(input.linkId, guidanceSnapshotRef(input.selfInstallationDid)),
  });
  if (!held) return null;
  const verified = verifyGuidanceSnapshot(held.payload, {
    expectedAuthorityDid: link.peerDeviceId,
    selfInstallationDid: input.selfInstallationDid,
    heldVersion: null,
    now: new Date(),
    checkExpiry: false,
  });
  return verified.ok ? verified.snapshot : null;
}
