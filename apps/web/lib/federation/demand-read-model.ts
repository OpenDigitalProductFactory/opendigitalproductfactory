import { cache } from "react";

import { prisma } from "@dpf/db";
import { FEDERATED_WORK_ORIGIN_MARKER_SQL_PREFIX } from "@dpf/db/federated-work-contract";

import { decodeDemandMirrorPayload, type DemandDisposition } from "./demand-exchange";
import { decodeDemandResponseMirrorPayload } from "./demand-response";
import { decodeDemandDispositionMirrorPayload } from "./demand-disposition";

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
  role: "managed-by" | "channel-downstream";
  destinationKind: "distributor" | "founder-hub";
  sharedItemIds: string[];
}

interface DemandShareLinkRow {
  linkId: string;
  role: string;
  peerInstallationId: string | null;
  principal: { displayName: string };
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
    /** The originator's local backlog item this response is about (from the
     *  linked mirror), so a renderer can show responses ON the item rather than
     *  as a disconnected global list. Null only for legacy unlinked mirrors. */
    localItemId: string | null;
    sourceName: string;
    responseKind: "interest" | "help-offer";
    message: string | null;
    receivedAt: string;
  }>;
  dispositions: Array<{
    noticeId: string;
    decision: "accepted" | "rejected" | "archived";
    message: string | null;
    releaseApplicability: { releaseRef?: string; applicability: string } | null;
    receivedAt: string;
  }>;
}

interface DemandReadRow {
  mirrorId: string;
  syncStatus: string;
  version: bigint;
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
      originVersion: Number(row.version),
      updatedAt: (row.lastSyncedAt ?? new Date(payload.receivedAt)).toISOString(),
      localItemId: row.localRecordRef,
      forwardingToFounderPermitted:
        envelope.forwarding?.permitted === true
        && envelope.forwarding.audiences.includes("founder"),
      forwardingExpiresAt: envelope.forwarding?.expiresAt ?? null,
    }];
  });
}

/** Pure mapper: incoming demand-response mirrors → the view's response list,
 *  each carrying the originator's local item id (from the linked mirror) so a
 *  renderer can attribute a response to the item it is about. Exported for unit
 *  testing without a DB, matching the other read-model mappers. */
export function mapDemandResponses(
  responseMirrors: Array<{ federationLinkId: string; localRecordRef: string | null; payload: unknown }>,
  links: Array<{ linkId: string; principal: { displayName: string } }>,
): DemandShareContext["responses"] {
  return responseMirrors.flatMap((mirror) => {
    const payload = decodeDemandResponseMirrorPayload(mirror.payload);
    if (!payload) return [];
    const source = links.find((link) => link.linkId === mirror.federationLinkId);
    return [{
      responseId: payload.response.responseId,
      localItemId: mirror.localRecordRef,
      sourceName: source?.principal.displayName ?? "Connected installation",
      responseKind: payload.response.responseKind,
      message: payload.response.message ?? null,
      receivedAt: payload.receivedAt,
    }];
  });
}

export function mapDemandShareTargets(
  links: DemandShareLinkRow[],
  sharedByLink: ReadonlyMap<string, string[]>,
): DemandShareTarget[] {
  return links.flatMap((link) => {
    if (link.role !== "managed-by" && link.role !== "channel-downstream") return [];
    return [{
      linkId: link.linkId,
      displayName: link.principal.displayName,
      role: link.role,
      destinationKind: link.role === "managed-by" ? "distributor" : "founder-hub",
      sharedItemIds: sharedByLink.get(link.linkId) ?? [],
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
  const [links, localItems, mirrors, responseMirrors, dispositionMirrors] = await Promise.all([
    prisma.federationLink.findMany({
      where: {
        role: { in: ["managed-by", "channel-downstream"] },
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
        NOT: [
          { body: { contains: "[origin:federatedDemand:" } },
          // A work-sync mirror is not local demand to share (BI-FF8A57EF).
          { body: { contains: FEDERATED_WORK_ORIGIN_MARKER_SQL_PREFIX } },
        ],
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
        localRecordRef: true,
        payload: true,
      },
      orderBy: { lastSyncedAt: "desc" },
      take: 200,
    }),
    prisma.federatedRecordMirror.findMany({
      where: { recordType: "demand-disposition", canonicalSide: "peer", syncStatus: "synced" },
      select: { payload: true },
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
  const targets = mapDemandShareTargets(links, sharedByLink);
  return {
    targets,
    founderTargets: links
      .filter((link) => link.role === "channel-downstream" && link.peerInstallationId)
      .map((link) => ({ linkId: link.linkId, displayName: link.principal.displayName })),
    localItems,
    responses: mapDemandResponses(responseMirrors, links),
    dispositions: dispositionMirrors.flatMap((mirror) => {
      const payload = decodeDemandDispositionMirrorPayload(mirror.payload);
      if (!payload) return [];
      return [{
        noticeId: payload.notice.noticeId,
        decision: payload.notice.decision,
        message: payload.notice.message ?? null,
        releaseApplicability: payload.notice.releaseApplicability ?? null,
        receivedAt: payload.receivedAt,
      }];
    }),
  };
});
