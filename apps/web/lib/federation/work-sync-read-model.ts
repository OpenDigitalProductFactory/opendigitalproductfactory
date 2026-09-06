// BI-FF8A57EF / BI-C5456B79 / EP-ZERO-CONFIG-FEDERATION §5.7 — operator-facing
// view of same-organization work sync: per connection, how many of the peer's
// backlog rows are mirrored here, when the last pull landed, what the last pull
// reported, and the ONE health sentence every surface shows. Mappers are pure;
// only the loaders touch the database.

import { cache } from "react";

import { prisma } from "@dpf/db";
import {
  resolveFederationHealth,
  type FederationHealth,
  type FederationLinkHealthInput,
  type WorkSyncPullOutcome,
} from "@dpf/db/federation-health";

import { WORK_SYNC_HEALTH_KEY, type WorkSyncHealthRecordV1 } from "./work-sync";

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
  /** What the last pull reported, when the runner has recorded one. */
  lastOutcome: WorkSyncPullOutcome | null;
  lastDetail: string | null;
  /** The health sentence for this connection alone. */
  healthLine: string;
  healthState: FederationHealth["state"];
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

export function parseWorkSyncHealthRecord(value: unknown): WorkSyncHealthRecordV1 | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Partial<WorkSyncHealthRecordV1>;
  if (record.schemaVersion !== 1 || !Array.isArray(record.links)) return null;
  return record as WorkSyncHealthRecordV1;
}

export function mapWorkSyncLinks(
  links: readonly WorkSyncLinkRow[],
  mirrors: readonly WorkSyncMirrorSummaryRow[],
  health: WorkSyncHealthRecordV1 | null,
  now: Date = new Date(),
): { links: WorkSyncLinkView[]; health: FederationHealth } {
  const inputs: FederationLinkHealthInput[] = [];
  const base = links.map((link) => {
    const rows = mirrors.filter((row) => row.federationLinkId === link.linkId);
    const newest = rows.reduce<Date | null>(
      (max, row) => (row.lastSyncedAt && (!max || row.lastSyncedAt > max) ? row.lastSyncedAt : max),
      null,
    );
    const recorded = health?.links.find((entry) => entry.linkId === link.linkId) ?? null;
    const view = {
      linkId: link.linkId,
      peerLabel: link.principal?.displayName ?? link.linkId,
      peerAuthorityUrl: link.peerAuthorityUrl,
      mirroredItems: rows.filter((row) => row.recordType === "backlog-item" && row.syncStatus === "synced").length,
      mirroredEpics: rows.filter((row) => row.recordType === "epic" && row.syncStatus === "synced").length,
      conflicts: rows.filter((row) => row.syncStatus === "conflict").length,
      withdrawn: rows.filter((row) => row.recordType === "backlog-item" && row.syncStatus === "withdrawn").length,
      lastSyncedAt: newest?.toISOString() ?? null,
      lastOutcome: recorded?.outcome ?? null,
      lastDetail: recorded?.detail ?? null,
    };
    inputs.push({
      linkId: view.linkId, peerLabel: view.peerLabel, mirroredItems: view.mirroredItems,
      lastPullAt: newest, lastOutcome: view.lastOutcome, lastDetail: view.lastDetail, conflicts: view.conflicts,
    });
    return view;
  });
  const resolved = resolveFederationHealth({ links: inputs, now });
  return {
    health: resolved,
    links: base.map((view) => {
      const perLink = resolved.links.find((l) => l.linkId === view.linkId);
      return { ...view, healthLine: perLink?.line ?? resolved.line, healthState: perLink?.state ?? resolved.state };
    }),
  };
}

async function loadWorkSyncFacts(): Promise<{ links: WorkSyncLinkView[]; health: FederationHealth }> {
  const links = await prisma.federationLink.findMany({
    where: { role: "same-org-peer", linkState: "trusted", revokedAt: null, quarantinedAt: null },
    orderBy: { createdAt: "asc" },
    select: { linkId: true, peerAuthorityUrl: true, principal: { select: { displayName: true } } },
  });
  if (links.length === 0) return mapWorkSyncLinks([], [], null);
  const [mirrors, healthRow] = await Promise.all([
    prisma.federatedRecordMirror.findMany({
      where: {
        federationLinkId: { in: links.map((link) => link.linkId) },
        recordType: { in: ["backlog-item", "epic"] },
        canonicalSide: "peer",
      },
      select: { federationLinkId: true, recordType: true, syncStatus: true, lastSyncedAt: true },
    }),
    prisma.platformConfig.findUnique({ where: { key: WORK_SYNC_HEALTH_KEY }, select: { value: true } }),
  ]);
  return mapWorkSyncLinks(links, mirrors, parseWorkSyncHealthRecord(healthRow?.value));
}

const loadCached = cache(loadWorkSyncFacts);

export const getWorkSyncLinks = async (): Promise<WorkSyncLinkView[]> => (await loadCached()).links;

/** The one sentence (EP-ZERO-CONFIG-FEDERATION §5.7). */
export const getFederationHealth = async (): Promise<FederationHealth> => (await loadCached()).health;
