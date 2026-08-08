import { createHash } from "node:crypto";

import {
  validateDemandEnvelopeV1,
  type DemandActivity,
  type DemandEnvelopeV1,
} from "@dpf/db/federated-demand-contract";

import type { BacklogIngestInput, BacklogIngestResult } from "@/lib/operate/backlog-ingest";
import { BACKLOG_WORK_TYPE_VALUES, type BacklogWorkType } from "@/lib/explore/backlog";
import { compareVersionVectors, isVersionVector } from "./version-vector";

export type InboundDemandActivity = Extract<
  DemandActivity,
  "dpf.demand.proposed" | "dpf.demand.updated" | "dpf.demand.withdrawn"
>;

export type DemandDisposition = "observed" | "followed" | "adopted" | "withdrawn";

export interface DemandMirrorPayload {
  envelope: DemandEnvelopeV1;
  activity: InboundDemandActivity;
  disposition: DemandDisposition;
  receivedAt: string;
}

export interface DemandMirrorRow {
  mirrorId: string;
  federationLinkId: string;
  peerRecordRef: string | null;
  localRecordRef: string | null;
  version: bigint;
  syncStatus: string;
  payload: unknown;
  versionVector?: unknown;
}

export interface DemandExchangeDb {
  federatedRecordMirror: {
    findUnique(args: unknown): Promise<DemandMirrorRow | null>;
    create(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<{ count: number }>;
    update(args: unknown): Promise<unknown>;
  };
}

export type AdoptDemandIngest = (input: BacklogIngestInput) => Promise<BacklogIngestResult>;

export type IncomingDemandResult =
  | { action: "created" | "updated" | "withdrawn" | "noop"; mirrorId: string; originVersion: number; disposition: DemandDisposition }
  | { action: "conflict"; mirrorId: string; originVersion: number; reason: "origin-version-not-advancing" | "concurrent-update" }
  | { action: "rejected"; violations: string[] };

function peerRecordRef(envelope: DemandEnvelopeV1): string {
  return `${envelope.originInstallationId}:${envelope.originRecordRef}`;
}

function mirrorId(linkId: string, peerRef: string): string {
  return `fdm_${createHash("sha256").update(`${linkId}\u0000${peerRef}`).digest("hex").slice(0, 24)}`;
}

function demandWhere(linkId: string, peerRef: string) {
  return {
    federationLinkId_recordType_peerRecordRef: {
      federationLinkId: linkId,
      recordType: "demand-envelope",
      peerRecordRef: peerRef,
    },
  };
}

export function decodeDemandMirrorPayload(value: unknown): DemandMirrorPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Partial<DemandMirrorPayload>;
  if (!payload.envelope || typeof payload.envelope !== "object") return null;
  return payload as DemandMirrorPayload;
}

function demandWorkType(value: string | undefined): BacklogWorkType {
  return value && (BACKLOG_WORK_TYPE_VALUES as readonly string[]).includes(value)
    ? value as BacklogWorkType
    : "feature";
}

function isUniqueConflict(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

/**
 * Persist one peer demand envelope before any local semantic action is applied.
 *
 * The peer-origin composite key supplies database-level idempotency. Updates use
 * a conditional version predicate so concurrent deliveries can only advance the
 * mirror; an older request can never overwrite a newer committed envelope.
 */
export async function handleIncomingDemand(
  db: DemandExchangeDb,
  linkId: string,
  activity: InboundDemandActivity,
  envelope: DemandEnvelopeV1,
  options: { receivingInstallationId?: string; now?: Date } = {},
): Promise<IncomingDemandResult> {
  const violations = validateDemandEnvelopeV1(envelope, {
    receivingInstallationId: options.receivingInstallationId,
  });
  if (violations.length > 0) return { action: "rejected", violations };

  const peerRef = peerRecordRef(envelope);
  const where = demandWhere(linkId, peerRef);
  const id = mirrorId(linkId, peerRef);
  const receivedAt = (options.now ?? new Date()).toISOString();
  const disposition: DemandDisposition = activity === "dpf.demand.withdrawn" ? "withdrawn" : "observed";
  const syncStatus = disposition === "withdrawn" ? "withdrawn" : "synced";
  const payload: DemandMirrorPayload = { envelope, activity, disposition, receivedAt };

  let existing = await db.federatedRecordMirror.findUnique({ where });
  if (!existing) {
    try {
      await db.federatedRecordMirror.create({
        data: {
          mirrorId: id,
          federationLinkId: linkId,
          recordType: "demand-envelope",
          canonicalSide: "peer",
          localRecordRef: null,
          peerRecordRef: peerRef,
          syncStatus,
          version: envelope.originVersion,
          ...(isVersionVector(envelope.versionVector) ? { versionVector: envelope.versionVector } : {}),
          payload,
          lastSyncedAt: new Date(receivedAt),
        },
      });
      return {
        action: disposition === "withdrawn" ? "withdrawn" : "created",
        mirrorId: id,
        originVersion: envelope.originVersion,
        disposition,
      };
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      existing = await db.federatedRecordMirror.findUnique({ where });
      if (!existing) throw error;
    }
  }

  const current = decodeDemandMirrorPayload(existing.payload);

  // Causal-vector conflict detection (BI-67315C4A): when BOTH sides carry a version
  // vector, a "concurrent" comparison is a genuine concurrent edit that the scalar
  // `version` cannot see — surface it as a conflict rather than let one side's write
  // silently clobber the other. Ordering otherwise still flows through the scalar
  // below (back-compat with peers that send no vector).
  if (
    isVersionVector(envelope.versionVector)
    && isVersionVector(existing.versionVector)
    && compareVersionVectors(envelope.versionVector, existing.versionVector) === "concurrent"
  ) {
    return {
      action: "conflict",
      mirrorId: existing.mirrorId,
      originVersion: Number(existing.version),
      reason: "concurrent-update",
    };
  }

  if (
    Number(existing.version) === envelope.originVersion
    && current?.envelope.payloadDigest === envelope.payloadDigest
    && current.activity === activity
  ) {
    return {
      action: "noop",
      mirrorId: existing.mirrorId,
      originVersion: Number(existing.version),
      disposition: current.disposition,
    };
  }
  if (envelope.originVersion <= Number(existing.version)) {
    return {
      action: "conflict",
      mirrorId: existing.mirrorId,
      originVersion: Number(existing.version),
      reason: "origin-version-not-advancing",
    };
  }

  const advanced = await db.federatedRecordMirror.updateMany({
    where: {
      federationLinkId: linkId,
      recordType: "demand-envelope",
      peerRecordRef: peerRef,
      version: { lt: envelope.originVersion },
    },
    data: {
      syncStatus,
      version: envelope.originVersion,
      ...(isVersionVector(envelope.versionVector) ? { versionVector: envelope.versionVector } : {}),
      payload,
      conflictReason: null,
      lastSyncedAt: new Date(receivedAt),
    },
  });
  if (advanced.count !== 1) {
    return {
      action: "conflict",
      mirrorId: existing.mirrorId,
      originVersion: Number(existing.version),
      reason: "concurrent-update",
    };
  }

  return {
    action: disposition === "withdrawn" ? "withdrawn" : "updated",
    mirrorId: existing.mirrorId,
    originVersion: envelope.originVersion,
    disposition,
  };
}

export async function setIncomingDemandDisposition(
  db: DemandExchangeDb,
  id: string,
  disposition: Extract<DemandDisposition, "observed" | "followed">,
): Promise<{ mirrorId: string; disposition: DemandDisposition }> {
  const mirror = await db.federatedRecordMirror.findUnique({ where: { mirrorId: id } });
  if (!mirror) throw new Error("Federated demand was not found.");
  const current = decodeDemandMirrorPayload(mirror.payload);
  if (!current) throw new Error("Federated demand payload is invalid.");
  if (mirror.syncStatus === "withdrawn" || current.disposition === "withdrawn") {
    throw new Error("Withdrawn demand cannot be followed.");
  }
  if (mirror.localRecordRef || current.disposition === "adopted") {
    throw new Error("Adopted demand is already managed through its local backlog item.");
  }

  await db.federatedRecordMirror.update({
    where: { mirrorId: id },
    data: { payload: { ...current, disposition } },
  });
  return { mirrorId: id, disposition };
}

/**
 * Adopt a received envelope into a new locally authoritative BacklogItem.
 * The shared ingest front door supplies the immutable origin activity/marker;
 * the mirror retains the peer envelope and binds it to the new local item.
 */
export async function adoptIncomingDemand(
  db: DemandExchangeDb,
  id: string,
  ingest: AdoptDemandIngest,
): Promise<{ action: "adopted" | "already-adopted"; itemId: string; created: boolean }> {
  const mirror = await db.federatedRecordMirror.findUnique({ where: { mirrorId: id } });
  if (!mirror) throw new Error("Federated demand was not found.");
  if (mirror.localRecordRef) {
    return { action: "already-adopted", itemId: mirror.localRecordRef, created: false };
  }
  const current = decodeDemandMirrorPayload(mirror.payload);
  if (!current) throw new Error("Federated demand payload is invalid.");
  if (mirror.syncStatus === "withdrawn" || current.disposition === "withdrawn") {
    throw new Error("Withdrawn demand cannot be adopted.");
  }
  if (!mirror.peerRecordRef) throw new Error("Federated demand origin is missing.");

  const result = await ingest({
    title: current.envelope.title,
    body: current.envelope.summary,
    workType: demandWorkType(current.envelope.workType),
    source: "user-request",
    type: "portfolio",
    status: "triaging",
    origin: {
      kind: "federatedDemand",
      id: `${mirror.federationLinkId}:${mirror.peerRecordRef}`,
    },
  });

  await db.federatedRecordMirror.update({
    where: { mirrorId: id },
    data: {
      localRecordRef: result.itemId,
      payload: { ...current, disposition: "adopted" },
    },
  });
  return { action: "adopted", itemId: result.itemId, created: result.created };
}
