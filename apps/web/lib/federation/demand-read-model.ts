import { cache } from "react";

import { prisma } from "@dpf/db";

import { decodeDemandMirrorPayload, type DemandDisposition } from "./demand-exchange";

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
