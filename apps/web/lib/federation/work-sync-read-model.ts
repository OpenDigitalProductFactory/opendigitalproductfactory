// BI-FF8A57EF / BI-C5456B79 — operator-facing view of same-organization work
// sync: per connection, how many of the peer's backlog rows are mirrored here,
// when the last pull landed, and whether anything is stuck. The mapper is pure;
// only the loader touches the database.

import { cache } from "react";

import { prisma } from "@dpf/db";

export interface WorkSyncLinkView {
  linkId: string;
  peerLabel: string;
  peerAuthorityUrl: string;
  mirroredItems: number;
  mirroredEpics: number;
  conflicts: number;
  withdrawn: number;
  /** ISO of the newest successful pull for this link, or null when nothing has landed yet. */
  lastSyncedAt: string | null;
}

export interface WorkSyncMirrorSummaryRow {
  federationLinkId: string;
  recordType: string;
  syncStatus: string;
  lastSyncedAt: Date | null;
}

export interface WorkSyncLinkRow {
  linkId: string;
  peerAuthorityUrl: string;
  principal: { displayName: string } | null;
}

export function mapWorkSyncLinks(
  links: readonly WorkSyncLinkRow[],
  mirrors: readonly WorkSyncMirrorSummaryRow[],
): WorkSyncLinkView[] {
  return links.map((link) => {
    const rows = mirrors.filter((row) => row.federationLinkId === link.linkId);
    const newest = rows.reduce<Date | null>(
      (max, row) => (row.lastSyncedAt && (!max || row.lastSyncedAt > max) ? row.lastSyncedAt : max),
      null,
    );
    return {
      linkId: link.linkId,
      peerLabel: link.principal?.displayName ?? link.linkId,
      peerAuthorityUrl: link.peerAuthorityUrl,
      mirroredItems: rows.filter((row) => row.recordType === "backlog-item" && row.syncStatus === "synced").length,
      mirroredEpics: rows.filter((row) => row.recordType === "epic" && row.syncStatus === "synced").length,
      conflicts: rows.filter((row) => row.syncStatus === "conflict").length,
      withdrawn: rows.filter((row) => row.recordType === "backlog-item" && row.syncStatus === "withdrawn").length,
      lastSyncedAt: newest?.toISOString() ?? null,
    };
  });
}

export const getWorkSyncLinks = cache(async (): Promise<WorkSyncLinkView[]> => {
  const links = await prisma.federationLink.findMany({
    where: { role: "same-org-peer", linkState: "trusted", revokedAt: null, quarantinedAt: null },
    orderBy: { createdAt: "asc" },
    select: { linkId: true, peerAuthorityUrl: true, principal: { select: { displayName: true } } },
  });
  if (links.length === 0) return [];
  const mirrors = await prisma.federatedRecordMirror.findMany({
    where: {
      federationLinkId: { in: links.map((link) => link.linkId) },
      recordType: { in: ["backlog-item", "epic"] },
      canonicalSide: "peer",
    },
    select: { federationLinkId: true, recordType: true, syncStatus: true, lastSyncedAt: true },
  });
  return mapWorkSyncLinks(links, mirrors);
});
