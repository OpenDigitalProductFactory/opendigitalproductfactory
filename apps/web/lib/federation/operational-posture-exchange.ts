// Cross-install operational control plane · Slice 2 Increment 2 (BI-648F01A0).
//
// Receiving side of the operational-posture exchange. A trusted same-organization
// peer reports its own posture; this install persists it as a PEER-canonical
// FederatedRecordMirror (recordType "operational-posture") and never mutates it —
// the origin is the only writer (reconcileMirror: non-canonical write = conflict).
// Mirrors handleIncomingDemand: validate first, composite-key idempotency, and a
// conditional version predicate so an older delivery can never overwrite a newer
// committed report.

import { createHash } from "node:crypto";

import {
  validateOperationalPostureV1,
  type OperationalPostureActivity,
  type OperationalPostureV1,
} from "@dpf/db/federated-operational-posture-contract";

export interface OperationalPostureMirrorPayload {
  record: OperationalPostureV1;
  activity: OperationalPostureActivity;
  receivedAt: string;
}

export interface OperationalPostureMirrorRow {
  mirrorId: string;
  federationLinkId: string;
  peerRecordRef: string | null;
  version: bigint;
  syncStatus: string;
  payload: unknown;
  lastSyncedAt?: Date | null;
}

export interface OperationalPostureExchangeDb {
  federatedRecordMirror: {
    findUnique(args: unknown): Promise<OperationalPostureMirrorRow | null>;
    create(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
}

export type IncomingOperationalPostureResult =
  | { action: "created" | "updated" | "noop"; mirrorId: string; originVersion: number }
  | { action: "conflict"; mirrorId: string; originVersion: number; reason: "origin-version-not-advancing" | "concurrent-update" }
  | { action: "rejected"; violations: string[] };

/** The singleton peer ref: one posture record per (link, reporting install). */
export function operationalPosturePeerRef(originInstallationId: string): string {
  return `posture:${originInstallationId}`;
}

function mirrorId(linkId: string, peerRef: string): string {
  return `fopm_${createHash("sha256").update(`${linkId} ${peerRef}`).digest("hex").slice(0, 24)}`;
}

function postureWhere(linkId: string, peerRef: string) {
  return {
    federationLinkId_recordType_peerRecordRef: {
      federationLinkId: linkId,
      recordType: "operational-posture",
      peerRecordRef: peerRef,
    },
  };
}

export function decodeOperationalPostureMirrorPayload(value: unknown): OperationalPostureMirrorPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Partial<OperationalPostureMirrorPayload>;
  if (!payload.record || typeof payload.record !== "object") return null;
  return payload as OperationalPostureMirrorPayload;
}

function isUniqueConflict(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

export async function handleIncomingOperationalPosture(
  db: OperationalPostureExchangeDb,
  linkId: string,
  record: OperationalPostureV1,
  options: { now?: Date } = {},
): Promise<IncomingOperationalPostureResult> {
  const violations = validateOperationalPostureV1(record);
  if (violations.length > 0) return { action: "rejected", violations };

  const peerRef = operationalPosturePeerRef(record.originInstallationId);
  const where = postureWhere(linkId, peerRef);
  const id = mirrorId(linkId, peerRef);
  const receivedAt = (options.now ?? new Date()).toISOString();
  const payload: OperationalPostureMirrorPayload = {
    record,
    activity: "dpf.operational-posture.reported",
    receivedAt,
  };

  let existing = await db.federatedRecordMirror.findUnique({ where });
  if (!existing) {
    try {
      await db.federatedRecordMirror.create({
        data: {
          mirrorId: id,
          federationLinkId: linkId,
          recordType: "operational-posture",
          canonicalSide: "peer",
          localRecordRef: null,
          peerRecordRef: peerRef,
          syncStatus: "synced",
          version: record.originVersion,
          payload,
          lastSyncedAt: new Date(receivedAt),
        },
      });
      return { action: "created", mirrorId: id, originVersion: record.originVersion };
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      existing = await db.federatedRecordMirror.findUnique({ where });
      if (!existing) throw error;
    }
  }

  const current = decodeOperationalPostureMirrorPayload(existing.payload);
  if (
    Number(existing.version) === record.originVersion
    && current?.record.payloadDigest === record.payloadDigest
  ) {
    return { action: "noop", mirrorId: existing.mirrorId, originVersion: Number(existing.version) };
  }
  if (record.originVersion <= Number(existing.version)) {
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
      recordType: "operational-posture",
      peerRecordRef: peerRef,
      version: { lt: record.originVersion },
    },
    data: {
      syncStatus: "synced",
      version: record.originVersion,
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
  return { action: "updated", mirrorId: existing.mirrorId, originVersion: record.originVersion };
}
