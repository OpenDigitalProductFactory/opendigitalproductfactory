import { createHmac } from "node:crypto";

import {
  computeDemandResponseDigest,
  validateDemandResponseV1,
  type DemandResponseKind,
  type DemandResponseV1,
} from "@dpf/db/federated-demand-contract";

import {
  decodeDemandOutboxPayload,
  type DemandDeliveryDb,
  type DemandLinkTarget,
} from "./demand-delivery";
import { decodeDemandMirrorPayload } from "./demand-exchange";
import type { FederationIdentity } from "./demand-identity";

interface ResponseMirrorRow {
  mirrorId: string;
  federationLinkId: string;
  canonicalSide: string;
  localRecordRef: string | null;
  peerRecordRef: string | null;
  syncStatus: string;
  version: bigint;
  payload: unknown;
}

export interface DemandResponseDb extends DemandDeliveryDb {
  federationLink: DemandDeliveryDb["federationLink"] & {
    findUnique(args: unknown): Promise<(DemandLinkTarget & { linkState: string; revokedAt: Date | null; quarantinedAt: Date | null }) | null>;
  };
  federatedRecordMirror: DemandDeliveryDb["federatedRecordMirror"] & {
    findUnique(args: unknown): Promise<ResponseMirrorRow | null>;
    findMany(args: unknown): Promise<ResponseMirrorRow[]>;
  };
}

export interface DemandResponseMirrorPayload {
  response: DemandResponseV1;
  receivedAt: string;
}

export function decodeDemandResponseMirrorPayload(value: unknown): DemandResponseMirrorPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Partial<DemandResponseMirrorPayload>;
  if (!payload.response || validateDemandResponseV1(payload.response).length > 0) return null;
  return payload as DemandResponseMirrorPayload;
}

function responseId(
  identity: FederationIdentity,
  linkId: string,
  originRecordRef: string,
  kind: DemandResponseKind,
): string {
  return `rsp_${createHmac("sha256", identity.projectionSecret)
    .update(`${linkId}\u0000${originRecordRef}\u0000${kind}`)
    .digest("hex")}`;
}

export async function queueDemandResponse(
  db: DemandResponseDb,
  input: {
    mirrorId: string;
    kind: DemandResponseKind;
    message?: string;
    identity: FederationIdentity;
    now?: Date;
  },
): Promise<{ action: "queued" | "noop"; responseId: string }> {
  const incoming = await db.federatedRecordMirror.findUnique({ where: { mirrorId: input.mirrorId } });
  if (!incoming || incoming.canonicalSide !== "peer") throw new Error("Incoming shared demand was not found.");
  const demand = decodeDemandMirrorPayload(incoming.payload);
  if (!demand || demand.disposition === "withdrawn" || incoming.syncStatus === "withdrawn") {
    throw new Error("Withdrawn or invalid demand cannot receive a response.");
  }
  const link = await db.federationLink.findUnique({ where: { linkId: incoming.federationLinkId } });
  if (!link || link.linkState !== "trusted" || link.revokedAt || link.quarantinedAt) {
    throw new Error("The source connection is not trusted and active.");
  }
  const id = responseId(input.identity, link.linkId, demand.envelope.originRecordRef, input.kind);
  const localRecordRef = `response:${input.mirrorId}:${input.kind}`;
  const existing = await db.federatedRecordMirror.findUnique({
    where: {
      federationLinkId_recordType_localRecordRef: {
        federationLinkId: link.linkId,
        recordType: "demand-response",
        localRecordRef,
      },
    },
  });
  if (existing?.syncStatus === "synced") return { action: "noop", responseId: id };
  const createdAt = (input.now ?? new Date()).toISOString();
  const response: DemandResponseV1 = {
    specVersion: "dpf.demand-response/1",
    responseId: id,
    envelopeId: demand.envelope.envelopeId,
    originInstallationId: demand.envelope.originInstallationId,
    originRecordRef: demand.envelope.originRecordRef,
    responseKind: input.kind,
    ...(input.message?.trim() ? { message: input.message.trim().slice(0, 1_000) } : {}),
    responderAttribution: "organization",
    createdAt,
    payloadDigest: "sha256:pending",
  };
  response.payloadDigest = computeDemandResponseDigest(response);
  const activity = input.kind === "help-offer"
    ? "dpf.demand.help-offered" as const
    : "dpf.demand.interest-recorded" as const;
  const data = {
    syncStatus: "pending",
    version: (input.now ?? new Date()).getTime(),
    payload: { envelope: response, activity, eventId: id, queuedAt: createdAt },
    deliveryAttempts: 0,
    nextDeliveryAt: input.now ?? new Date(),
    lastDeliveryError: null,
    deadLetteredAt: null,
  };
  if (existing) {
    await db.federatedRecordMirror.update({ where: { mirrorId: existing.mirrorId }, data });
  } else {
    await db.federatedRecordMirror.create({ data: {
      mirrorId: `fdr_${id.slice(4, 28)}`,
      federationLinkId: link.linkId,
      recordType: "demand-response",
      canonicalSide: "local",
      localRecordRef,
      peerRecordRef: null,
      ...data,
    } });
  }
  return { action: "queued", responseId: id };
}

export async function handleIncomingDemandResponse(
  db: DemandResponseDb,
  linkId: string,
  response: DemandResponseV1,
  now = new Date(),
): Promise<{ action: "created" | "noop" | "rejected"; responseId?: string; violations?: string[] }> {
  const violations = validateDemandResponseV1(response);
  if (violations.length > 0) return { action: "rejected", violations };
  const shared = await db.federatedRecordMirror.findMany({
    where: { federationLinkId: linkId, recordType: "demand-envelope", canonicalSide: "local" },
    select: { payload: true, localRecordRef: true },
    take: 1_000,
  });
  // Correlate the incoming response to the exact demand WE projected, and keep the
  // matched row so we can bind the response to the ORIGINATOR's local item below.
  const matchedEnvelope = shared.find((row) => {
    const payload = decodeDemandOutboxPayload(row.payload);
    return payload?.envelope.specVersion === "dpf.demand/1"
      && payload.envelope.envelopeId === response.envelopeId
      && payload.envelope.originInstallationId === response.originInstallationId
      && payload.envelope.originRecordRef === response.originRecordRef;
  });
  if (!matchedEnvelope) return { action: "rejected", violations: ["response:unknown-envelope"] };
  const where = {
    federationLinkId_recordType_peerRecordRef: {
      federationLinkId: linkId,
      recordType: "demand-response",
      peerRecordRef: response.responseId,
    },
  };
  const existing = await db.federatedRecordMirror.findUnique({ where });
  if (existing) return { action: "noop", responseId: response.responseId };
  await db.federatedRecordMirror.create({ data: {
    mirrorId: `fdri_${response.responseId.slice(4, 28)}`,
    federationLinkId: linkId,
    recordType: "demand-response",
    canonicalSide: "peer",
    // Bind the response to the originator's local backlog item (the outbound
    // mirror's localRecordRef is the BacklogItem id) so it is no longer orphaned
    // and a read model can surface "who responded" on the item itself.
    localRecordRef: matchedEnvelope.localRecordRef,
    peerRecordRef: response.responseId,
    syncStatus: "synced",
    version: 1,
    payload: { response, receivedAt: now.toISOString() },
    lastSyncedAt: now,
  } });
  return { action: "created", responseId: response.responseId };
}
