import { cache } from "react";

import { prisma } from "@dpf/db";

import { decodeDemandMirrorPayload, type DemandDisposition } from "./demand-exchange";
import { decodeDemandResponseMirrorPayload } from "./demand-response";

export interface NetworkDemandView {
  mirrorId: string;
  title: string;
  summary: string;
  workType: string | null;
  attribution: string;
  occurrenceCount: number;
  affectedOrganizations: number | null;
  disposition: DemandDisposition;
  syncStatus: string;
  originVersion: number;
  updatedAt: string;
  localItemId: string | null;
  forwardingToFounderPermitted: boolean;
  forwardingExpiresAt: string | null;
}

export interface DemandShareTarget {
  linkId: string;
  displayName: string;
  role: string;
  sharedItemIds: string[];
}

export interface LocalDemandShareCandidate {
  itemId: string;
  title: string;
  status: string;
}

export interface DemandShareContext {
  targets: DemandShareTarget[];
  founderTargets: Array<{ linkId: string; displayName: string }>;
  localItems: LocalDemandShareCandidate[];
  responses: Array<{
    responseId: string;
    sourceName: string;
    responseKind: "interest" | "help-offer";
    message: string | null;
    receivedAt: string;
  }>;
}

interface DemandReadRow {
  mirrorId: string;
  syncStatus: string;
  version: number;
  localRecordRef: string | null;
  lastSyncedAt: Date | null;
  payload: unknown;
}

export function mapNetworkDemandRows(rows: DemandReadRow[]): NetworkDemandView[] {
  return rows.flatMap((row) => {
    const payload = decodeDemandMirrorPayload(row.payload);
    if (!payload) return [];
    const envelope = payload.envelope;
    return [{
      mirrorId: row.mirrorId,
      title: envelope.title,
      summary: envelope.summary,
      workType: envelope.workType ?? null,
      attribution: envelope.attribution,
      occurrenceCount: envelope.signal.occurrenceCount,
      affectedOrganizations: envelope.signal.affectedOrganizations ?? null,
      disposition: payload.disposition,
      syncStatus: row.syncStatus,
      originVersion: row.version,
      updatedAt: (row.lastSyncedAt ?? new Date(payload.receivedAt)).toISOString(),
      localItemId: row.localRecordRef,
      forwardingToFounderPermitted:
        envelope.forwarding?.permitted === true
        && envelope.forwarding.audiences.includes("founder"),
      forwardingExpiresAt: envelope.forwarding?.expiresAt ?? null,
    }];
  });
}

export const getNetworkDemandItems = cache(async (): Promise<NetworkDemandView[]> => {
  const rows = await prisma.federatedRecordMirror.findMany({
    where: { recordType: "demand-envelope", canonicalSide: "peer" },
    orderBy: { lastSyncedAt: "desc" },
    select: {
      mirrorId: true,
      syncStatus: true,
      version: true,
      localRecordRef: true,
      lastSyncedAt: true,
      payload: true,
    },
  });
  return mapNetworkDemandRows(rows);
});

export const getDemandShareContext = cache(async (): Promise<DemandShareContext> => {
  const [links, localItems, mirrors, responseMirrors] = await Promise.all([
    prisma.federationLink.findMany({
      where: {
        role: { in: ["manages", "managed-by", "channel-upstream", "channel-downstream"] },
        linkState: "trusted",
        revokedAt: null,
        quarantinedAt: null,
      },
      select: {
        linkId: true,
        role: true,
        peerInstallationId: true,
        principal: { select: { displayName: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.backlogItem.findMany({
      where: {
        status: { in: ["open", "in-progress"] },
        NOT: { body: { contains: "[origin:federatedDemand:" } },
      },
      select: { itemId: true, title: true, status: true },
      orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
      take: 200,
    }),
    prisma.federatedRecordMirror.findMany({
      where: {
        recordType: "demand-envelope",
        canonicalSide: "local",
        localRecordRef: { not: null },
        syncStatus: { notIn: ["withdrawn", "revoked"] },
      },
      select: { federationLinkId: true, localRecordRef: true },
    }),
    prisma.federatedRecordMirror.findMany({
      where: { recordType: "demand-response", canonicalSide: "peer", syncStatus: "synced" },
      select: {
        federationLinkId: true,
        payload: true,
      },
      orderBy: { lastSyncedAt: "desc" },
      take: 200,
    }),
  ]);
  const sharedByLink = new Map<string, string[]>();
  for (const mirror of mirrors) {
    if (!mirror.localRecordRef || mirror.localRecordRef.startsWith("forward:")) continue;
    const refs = sharedByLink.get(mirror.federationLinkId) ?? [];
    refs.push(mirror.localRecordRef);
    sharedByLink.set(mirror.federationLinkId, refs);
  }
  return {
    targets: links.map((link) => ({
      linkId: link.linkId,
      displayName: link.principal.displayName,
      role: link.role,
      sharedItemIds: sharedByLink.get(link.linkId) ?? [],
    })),
    founderTargets: links
      .filter((link) => link.role === "channel-downstream" && link.peerInstallationId)
      .map((link) => ({ linkId: link.linkId, displayName: link.principal.displayName })),
    localItems,
    responses: responseMirrors.flatMap((mirror) => {
      const payload = decodeDemandResponseMirrorPayload(mirror.payload);
      if (!payload) return [];
      const source = links.find((link) => link.linkId === mirror.federationLinkId);
      return [{
        responseId: payload.response.responseId,
        sourceName: source?.principal.displayName ?? "Connected installation",
        responseKind: payload.response.responseKind,
        message: payload.response.message ?? null,
        receivedAt: payload.receivedAt,
      }];
    }),
  };
});
