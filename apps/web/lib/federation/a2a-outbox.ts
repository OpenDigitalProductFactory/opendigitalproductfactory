// Sender side of the federation A2A ingress (BI-B45BBD8A; A2A design §18.3).
//
// A request is signed when it is created, never at send time, and rides the
// shared federation outbox as record type "a2a-request". It inherits that
// outbox's hold-while-unreachable delivery, quarantine on a 401/403, and
// dead-letter. The sender's own TaskRun keeps the correlation in
// a2aMetadata.peer: the link, the requestId, and the receiver's task and context
// once the receiver acknowledges. TaskRun.status is a closed set, so the
// delivery states are there and not in status:
//   submitted-undelivered → acknowledged | rejected | expired-undelivered.

import { randomUUID } from "node:crypto";

import {
  A2A_REQUEST_DEFAULT_LIFETIME_MS,
  A2A_REQUEST_RECORD_TYPE,
  a2aActivityForOperation,
  type A2aRequestOperation,
  type A2aRequestProvenanceV1,
  type A2aRequestV1,
} from "@dpf/db/federated-a2a-contract";

import { signA2aRequest } from "./a2a-request-signing";
import { sendA2aRequestToPeer, type PeerLinkTarget, type PeerPostResult } from "./client";
import type { FederationSigningIdentity } from "./demand-identity";
import { scheduleFederationDeliveryJob, type FederationDeliveryQueueDb } from "./delivery-queue";

export type PeerDeliveryState = "submitted-undelivered" | "acknowledged" | "rejected" | "expired-undelivered";

export interface PeerDeliveryRecord {
  federationLinkId: string;
  requestId: string;
  operation: A2aRequestOperation;
  deliveryState: PeerDeliveryState;
  notAfter: string;
  remoteTaskId: string | null;
  remoteContextId: string | null;
  remoteState: string | null;
  rejectionReason: string | null;
  acknowledgedAt: string | null;
}

export interface A2aOutboxDb extends FederationDeliveryQueueDb {
  federatedRecordMirror: {
    create(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
  };
  taskRun: {
    findUnique(args: unknown): Promise<{ taskRunId: string; a2aMetadata: unknown } | null>;
    update(args: unknown): Promise<unknown>;
  };
}

type OutboxRow = { mirrorId: string; federationLinkId: string; payload: unknown };
type OutboxPayload = { request: A2aRequestV1; activity: string; eventId: string };

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

/** The sender's delivery record on a TaskRun, with expiry applied at read time. */
export function readPeerDelivery(a2aMetadata: unknown, now: Date = new Date()): PeerDeliveryRecord | null {
  const peer = rec(a2aMetadata).peer as PeerDeliveryRecord | undefined;
  if (!peer || typeof peer.requestId !== "string") return null;
  if (peer.deliveryState === "submitted-undelivered" && now.getTime() > Date.parse(peer.notAfter)) {
    return { ...peer, deliveryState: "expired-undelivered" };
  }
  return peer;
}

async function writePeerDelivery(
  db: A2aOutboxDb,
  taskRunId: string | null,
  change: (current: PeerDeliveryRecord | null) => PeerDeliveryRecord | null,
): Promise<void> {
  if (!taskRunId) return;
  const run = await db.taskRun.findUnique({ where: { taskRunId }, select: { taskRunId: true, a2aMetadata: true } });
  if (!run) return;
  const metadata = rec(run.a2aMetadata);
  const next = change((metadata.peer as PeerDeliveryRecord | undefined) ?? null);
  if (!next) return;
  await db.taskRun.update({ where: { taskRunId }, data: { a2aMetadata: { ...metadata, peer: next } } });
}

export async function queueA2aRequest(db: A2aOutboxDb, input: {
  linkId: string;
  operation: A2aRequestOperation;
  payload: Record<string, unknown>;
  /** The sender's local TaskRun that tracks this request, if any. */
  senderTaskRunId: string | null;
  contextId: string | null;
  provenance: A2aRequestProvenanceV1;
  targetInstallationDid: string;
  organizationRef: string;
  requesterEnvironmentClass: string | null;
  signing: FederationSigningIdentity;
  lifetimeMs?: number;
  now?: Date;
}): Promise<{ requestId: string; mirrorId: string }> {
  const now = input.now ?? new Date();
  const requestId = `a2r_${randomUUID().replace(/-/g, "")}`;
  const notAfter = new Date(now.getTime() + (input.lifetimeMs ?? A2A_REQUEST_DEFAULT_LIFETIME_MS)).toISOString();
  const request = signA2aRequest({
    specVersion: "dpf.a2a-request/1",
    requestId,
    operation: input.operation,
    createdAt: now.toISOString(),
    notAfter,
    targetInstallationDid: input.targetInstallationDid,
    organizationRef: input.organizationRef,
    requesterEnvironmentClass: input.requesterEnvironmentClass,
    senderTaskId: input.senderTaskRunId,
    contextId: input.contextId,
    provenance: input.provenance,
    payload: input.payload,
  }, { signingPublicKey: input.signing.signingPublicKey, signingPrivateKey: input.signing.signingPrivateKey });

  const mirrorId = `fa2o_${requestId.slice(4, 28)}`;
  const payload: OutboxPayload = { request, activity: a2aActivityForOperation(input.operation), eventId: `${input.linkId}:${requestId}` };
  await db.federatedRecordMirror.create({
    data: {
      mirrorId,
      federationLinkId: input.linkId,
      recordType: A2A_REQUEST_RECORD_TYPE,
      canonicalSide: "local",
      localRecordRef: requestId,
      peerRecordRef: null,
      syncStatus: "pending",
      version: 1,
      payload,
    },
  });
  await scheduleFederationDeliveryJob(db, mirrorId, now);
  await writePeerDelivery(db, input.senderTaskRunId, () => ({
    federationLinkId: input.linkId,
    requestId,
    operation: input.operation,
    deliveryState: "submitted-undelivered",
    notAfter,
    remoteTaskId: null,
    remoteContextId: input.contextId,
    remoteState: null,
    rejectionReason: null,
    acknowledgedAt: null,
  }));
  return { requestId, mirrorId };
}

function decodePayload(value: unknown): OutboxPayload | null {
  const payload = rec(value);
  const request = payload.request as A2aRequestV1 | undefined;
  if (!request || typeof request.requestId !== "string" || typeof payload.activity !== "string") return null;
  return { request, activity: payload.activity, eventId: String(payload.eventId ?? `${request.requestId}`) };
}

export type A2aDeliveryOutcome =
  | { kind: "expired" }
  | { kind: "sent"; result: PeerPostResult; acknowledged: boolean };

/**
 * Send one queued request. Called by the shared outbox sweep for record type
 * "a2a-request"; the sweep owns retry, quarantine and dead-letter from the
 * result. A receipt for this request, accepted or rejected, is the
 * acknowledgement: a refusal is the peer's decision and is not retried.
 */
export async function deliverA2aRequestRow(
  db: A2aOutboxDb,
  row: OutboxRow,
  target: PeerLinkTarget,
  options: { now: Date; send?: typeof sendA2aRequestToPeer },
): Promise<A2aDeliveryOutcome> {
  const payload = decodePayload(row.payload);
  if (!payload) return { kind: "sent", result: { ok: false, status: 0, error: "invalid outbox payload" }, acknowledged: false };
  const { request } = payload;

  if (options.now.getTime() > Date.parse(request.notAfter)) {
    await db.federatedRecordMirror.update({ where: { mirrorId: row.mirrorId }, data: { syncStatus: "withdrawn", lastDeliveryError: "notAfter passed before the peer acknowledged" } });
    await writePeerDelivery(db, request.senderTaskId, (current) => current && current.requestId === request.requestId
      ? { ...current, deliveryState: "expired-undelivered" }
      : null);
    return { kind: "expired" };
  }

  const result = await (options.send ?? sendA2aRequestToPeer)(target, payload.activity, request, { eventId: payload.eventId, now: options.now });
  const receipt = rec(result.body);
  const acknowledged = (result.status === 200 || result.status === 202)
    && receipt.specVersion === "dpf.a2a-receipt/1" && receipt.requestId === request.requestId;
  if (acknowledged) {
    await writePeerDelivery(db, request.senderTaskId, (current) => {
      if (!current || current.requestId !== request.requestId) return null;
      if (receipt.outcome === "rejected") {
        return { ...current, deliveryState: "rejected", rejectionReason: String(receipt.reason ?? "unknown"), acknowledgedAt: options.now.toISOString() };
      }
      return {
        ...current,
        deliveryState: "acknowledged",
        remoteTaskId: typeof receipt.receiverTaskId === "string" ? receipt.receiverTaskId : null,
        remoteState: typeof receipt.state === "string" ? receipt.state : null,
        acknowledgedAt: options.now.toISOString(),
      };
    });
  }
  return { kind: "sent", result, acknowledged };
}
