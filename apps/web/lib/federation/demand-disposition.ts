import { createHash } from "node:crypto";

import {
  computeDemandDispositionDigest,
  validateDemandDispositionNoticeV1,
  type DemandDispositionNoticeV1,
} from "@dpf/db/federated-demand-contract";

import { decodeDemandOutboxPayload, type DemandDeliveryDb } from "./demand-delivery";
import { scheduleFederationDeliveryJob } from "./delivery-queue";

interface DispositionDb extends DemandDeliveryDb {
  federatedRecordMirror: DemandDeliveryDb["federatedRecordMirror"] & {
    findMany(args: unknown): Promise<Array<{
      mirrorId: string;
      federationLinkId: string;
      payload: unknown;
    }>>;
  };
}

export interface DemandDispositionMirrorPayload {
  notice: DemandDispositionNoticeV1;
  receivedAt: string;
}

export function decodeDemandDispositionMirrorPayload(value: unknown): DemandDispositionMirrorPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Partial<DemandDispositionMirrorPayload>;
  if (!payload.notice || validateDemandDispositionNoticeV1(payload.notice).length > 0) return null;
  return payload as DemandDispositionMirrorPayload;
}

function noticeId(clusterId: string, linkId: string, envelopeId: string, decision: string): string {
  return `fdn_${createHash("sha256").update(`${clusterId}\u0000${linkId}\u0000${envelopeId}\u0000${decision}`).digest("hex").slice(0, 24)}`;
}

export async function queueFounderDispositionNotices(
  db: DispositionDb,
  input: {
    clusterId: string;
    decision: "accepted" | "rejected" | "archived";
    message?: string;
    releaseApplicability?: { releaseRef?: string; applicability: string };
    members: Array<{ originInstallationId: string; envelopeId: string; mirrorRefs: string[] }>;
    now?: Date;
  },
) {
  const mirrorIds = [...new Set(input.members.flatMap((member) => member.mirrorRefs))];
  const ingress = await db.federatedRecordMirror.findMany({
    where: { mirrorId: { in: mirrorIds }, canonicalSide: "peer", recordType: "demand-envelope" },
    select: { mirrorId: true, federationLinkId: true, payload: true },
  });
  const memberByMirror = new Map(input.members.flatMap((member) => member.mirrorRefs.map((id) => [id, member] as const)));
  const now = input.now ?? new Date();
  let queued = 0;
  for (const route of ingress) {
    const member = memberByMirror.get(route.mirrorId);
    if (!member) continue;
    const id = noticeId(input.clusterId, route.federationLinkId, member.envelopeId, input.decision);
    const notice: DemandDispositionNoticeV1 = {
      specVersion: "dpf.demand-disposition/1",
      noticeId: id,
      envelopeId: member.envelopeId,
      originInstallationId: member.originInstallationId,
      decision: input.decision,
      ...(input.message ? { message: input.message.slice(0, 1_000) } : {}),
      ...(input.releaseApplicability ? { releaseApplicability: input.releaseApplicability } : {}),
      createdAt: now.toISOString(),
      payloadDigest: "sha256:pending",
    };
    notice.payloadDigest = computeDemandDispositionDigest(notice);
    const localRecordRef = `disposition:${input.clusterId}:${member.envelopeId}`;
    const where = { federationLinkId_recordType_localRecordRef: {
      federationLinkId: route.federationLinkId,
      recordType: "demand-disposition",
      localRecordRef,
    } };
    const existing = await db.federatedRecordMirror.findUnique({ where });
    const version = existing ? Number(existing.version) + 1 : 1;
    if (version > Number.MAX_SAFE_INTEGER) throw new Error("Demand disposition version is exhausted.");
    const data = {
      syncStatus: "pending",
      version,
      payload: { envelope: notice, activity: "dpf.demand.dispositioned", eventId: id, queuedAt: now.toISOString() },
      deadLetteredAt: null,
    };
    const mirrorId = existing?.mirrorId ?? `fdno_${id.slice(4)}`;
    if (existing) await db.federatedRecordMirror.update({ where: { mirrorId }, data });
    else await db.federatedRecordMirror.create({ data: {
      mirrorId,
      federationLinkId: route.federationLinkId,
      recordType: "demand-disposition",
      canonicalSide: "local",
      localRecordRef,
      peerRecordRef: null,
      ...data,
    } });
    await scheduleFederationDeliveryJob(db, mirrorId, now);
    queued++;
  }
  return { queued };
}

export async function handleIncomingDemandDisposition(
  db: DispositionDb,
  linkId: string,
  notice: DemandDispositionNoticeV1,
  now = new Date(),
) {
  const violations = validateDemandDispositionNoticeV1(notice);
  if (violations.length > 0) return { action: "rejected" as const, violations };
  const shared = await db.federatedRecordMirror.findMany({
    where: { federationLinkId: linkId, recordType: "demand-envelope", canonicalSide: "local" },
    select: { payload: true },
    take: 1_000,
  });
  const known = shared.some((row) => {
    const payload = decodeDemandOutboxPayload(row.payload);
    return payload?.envelope.specVersion === "dpf.demand/1"
      && payload.envelope.envelopeId === notice.envelopeId
      && payload.envelope.originInstallationId === notice.originInstallationId;
  });
  if (!known) return { action: "rejected" as const, violations: ["notice:unknown-envelope"] };
  const where = { federationLinkId_recordType_peerRecordRef: {
    federationLinkId: linkId,
    recordType: "demand-disposition",
    peerRecordRef: notice.noticeId,
  } };
  const existing = await db.federatedRecordMirror.findUnique({ where });
  if (existing) return { action: "noop" as const, noticeId: notice.noticeId };
  await db.federatedRecordMirror.create({ data: {
    mirrorId: `fdni_${notice.noticeId.slice(4)}`,
    federationLinkId: linkId,
    recordType: "demand-disposition",
    canonicalSide: "peer",
    localRecordRef: null,
    peerRecordRef: notice.noticeId,
    syncStatus: "synced",
    version: 1,
    payload: { notice, receivedAt: now.toISOString() },
    lastSyncedAt: now,
  } });
  return { action: "created" as const, noticeId: notice.noticeId };
}
