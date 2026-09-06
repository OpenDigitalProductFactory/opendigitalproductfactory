// Cross-install operational control plane · Slice 3 (BI-648F01A0).
//
// Operator-facing view of the PAIRED ESTATE: this install's posture, captured
// live, beside every same-organization peer's posture, read from the
// peer-canonical `operational-posture` mirror it reported. Each side states its
// BASIS (captured here vs. reported by the peer) and its AGE, because a fleet
// picture that hides where a number came from is the assurance-honesty defect
// tracked in BI-DD93808A. Mappers are pure; only the loader touches the database.

import { cache } from "react";

import { prisma } from "@dpf/db";
import type {
  OperationalPostureV1,
  PostureHealthRollupV1,
  PosturePatchSummaryV1,
  PostureResourceFootprintV1,
  PostureRuntimeSummaryV1,
} from "@dpf/db/federated-operational-posture-contract";

import { OPERATIONAL_POSTURE_HEARTBEAT_MS } from "./operational-posture-delivery";
import { captureLocalOperationalPosture, type OperationalPostureCaptureDb } from "./operational-posture-capture";
import { decodeOperationalPostureMirrorPayload } from "./operational-posture-exchange";
import type { ProjectableOperationalPostureSource } from "./operational-posture-projection";

/** How a posture row came to be on this install. */
export type PostureBasis = "local-capture" | "mirrored-report";

/**
 * How much the age of a mirrored report should worry the operator. `fresh`
 * means a report landed within one heartbeat plus delivery slack; `stale`
 * means the peer has missed heartbeats; `silent` means it has been quiet for
 * long enough that its numbers describe a past, not a present.
 */
export type PostureFreshness = "fresh" | "stale" | "silent";

/** One heartbeat plus the outbox retry slack: a healthy peer always lands inside this. */
export const POSTURE_FRESH_WINDOW_MS = OPERATIONAL_POSTURE_HEARTBEAT_MS + 15 * 60_000;
/** Three missed heartbeats and the peer is treated as silent. */
export const POSTURE_SILENT_AFTER_MS = 3 * OPERATIONAL_POSTURE_HEARTBEAT_MS;

export interface PostureInstallView {
  key: string;
  label: string;
  basis: PostureBasis;
  installationId: string;
  /** Present only for a mirrored report. */
  linkId: string | null;
  servedVersion: string;
  servedSha: string;
  patchPosture: PosturePatchSummaryV1;
  health: PostureHealthRollupV1;
  runtime: PostureRuntimeSummaryV1;
  resourceFootprint: PostureResourceFootprintV1 | null;
  /** When the reporting install captured these numbers (ISO). */
  capturedAt: string;
  /** When the report landed here (ISO); equals capturedAt for the local capture. */
  receivedAt: string;
  ageMs: number;
  freshness: PostureFreshness;
  /** The honest one-liner: basis and age, e.g. "Reported by Example DEV · captured 4m ago". */
  basisLine: string;
}

export interface PairedEstatePostureView {
  local: PostureInstallView;
  peers: PostureInstallView[];
  /** Trusted same-organization links that have not reported a posture yet. */
  awaiting: Array<{ linkId: string; label: string }>;
}

export interface PostureLinkRow {
  linkId: string;
  peerAuthorityUrl: string;
  principal: { displayName: string } | null;
}

export interface PostureMirrorRow {
  federationLinkId: string;
  syncStatus: string;
  lastSyncedAt: Date | null;
  payload: unknown;
}

export function classifyPostureFreshness(ageMs: number): PostureFreshness {
  if (ageMs < POSTURE_FRESH_WINDOW_MS) return "fresh";
  if (ageMs < POSTURE_SILENT_AFTER_MS) return "stale";
  return "silent";
}

export function formatPostureAge(ageMs: number): string {
  const minutes = Math.max(0, Math.floor(ageMs / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function mapLocalPosture(
  source: ProjectableOperationalPostureSource,
  identity: { installationId: string; label: string },
  now: Date,
): PostureInstallView {
  const capturedAt = source.capturedAt.toISOString();
  const ageMs = Math.max(0, now.getTime() - source.capturedAt.getTime());
  return {
    key: "local",
    label: identity.label,
    basis: "local-capture",
    installationId: identity.installationId,
    linkId: null,
    servedVersion: source.servedVersion,
    servedSha: source.servedSha,
    patchPosture: source.patchPosture,
    health: source.health,
    runtime: source.runtime,
    resourceFootprint: source.resourceFootprint ?? null,
    capturedAt,
    receivedAt: capturedAt,
    ageMs,
    freshness: "fresh",
    basisLine: `Captured on this installation · ${formatPostureAge(ageMs)}`,
  };
}

export function mapPeerPosture(
  link: PostureLinkRow,
  record: OperationalPostureV1,
  receivedAt: Date | null,
  now: Date,
): PostureInstallView {
  const capturedAtMs = Date.parse(record.capturedAt);
  const capturedAt = Number.isFinite(capturedAtMs) ? new Date(capturedAtMs) : receivedAt ?? now;
  const landed = receivedAt ?? capturedAt;
  // Age is measured from the CAPTURE, not the delivery: a report that sat in a
  // retrying outbox for an hour is an hour old when it lands.
  const ageMs = Math.max(0, now.getTime() - capturedAt.getTime());
  const label = link.principal?.displayName ?? link.linkId;
  const freshness = classifyPostureFreshness(ageMs);
  // A silent peer's own health band is overtaken by the silence: the contract's
  // `offline` status is exactly this receiver-side judgement.
  const health: PostureHealthRollupV1 = freshness === "silent"
    ? { status: "offline", estateItemCount: record.health.estateItemCount }
    : record.health;
  return {
    key: `peer:${link.linkId}`,
    label,
    basis: "mirrored-report",
    installationId: record.originInstallationId,
    linkId: link.linkId,
    servedVersion: record.servedVersion,
    servedSha: record.servedSha,
    patchPosture: record.patchPosture,
    health,
    runtime: record.runtime,
    resourceFootprint: record.resourceFootprint ?? null,
    capturedAt: capturedAt.toISOString(),
    receivedAt: landed.toISOString(),
    ageMs,
    freshness,
    basisLine: `Reported by ${label} · captured ${formatPostureAge(ageMs)}`
      + (freshness === "silent" ? " · no report since" : freshness === "stale" ? " · missed heartbeats" : ""),
  };
}

export function mapPairedEstatePosture(input: {
  local: ProjectableOperationalPostureSource;
  identity: { installationId: string; label: string };
  links: readonly PostureLinkRow[];
  mirrors: readonly PostureMirrorRow[];
  now?: Date;
}): PairedEstatePostureView {
  const now = input.now ?? new Date();
  const peers: PostureInstallView[] = [];
  const awaiting: PairedEstatePostureView["awaiting"] = [];
  for (const link of input.links) {
    const row = input.mirrors.find((mirror) => mirror.federationLinkId === link.linkId && mirror.syncStatus === "synced");
    const payload = row ? decodeOperationalPostureMirrorPayload(row.payload) : null;
    if (!row || !payload) {
      awaiting.push({ linkId: link.linkId, label: link.principal?.displayName ?? link.linkId });
      continue;
    }
    peers.push(mapPeerPosture(link, payload.record, row.lastSyncedAt, now));
  }
  return { local: mapLocalPosture(input.local, input.identity, now), peers, awaiting };
}

export interface PairedEstatePostureDb extends OperationalPostureCaptureDb {
  federationLink: { findMany(args: unknown): Promise<PostureLinkRow[]> };
  federatedRecordMirror: { findMany(args: unknown): Promise<PostureMirrorRow[]> };
}

export async function loadPairedEstatePosture(
  db: PairedEstatePostureDb,
  identity: { installationId: string; label: string },
  deps: { capture?: typeof captureLocalOperationalPosture; now?: Date } = {},
): Promise<PairedEstatePostureView> {
  const now = deps.now ?? new Date();
  const [local, links] = await Promise.all([
    (deps.capture ?? captureLocalOperationalPosture)(db, { now }),
    db.federationLink.findMany({
      where: { role: "same-org-peer", linkState: "trusted", revokedAt: null, quarantinedAt: null },
      orderBy: { createdAt: "asc" },
      select: { linkId: true, peerAuthorityUrl: true, principal: { select: { displayName: true } } },
    }),
  ]);
  const mirrors = links.length === 0 ? [] : await db.federatedRecordMirror.findMany({
    where: {
      federationLinkId: { in: links.map((link) => link.linkId) },
      recordType: "operational-posture",
      canonicalSide: "peer",
    },
    select: { federationLinkId: true, syncStatus: true, lastSyncedAt: true, payload: true },
  });
  return mapPairedEstatePosture({ local, identity, links, mirrors, now });
}

/** Request-scoped loader for server components. */
export const getPairedEstatePosture = cache(
  async (identity: { installationId: string; label: string }): Promise<PairedEstatePostureView> =>
    loadPairedEstatePosture(prisma as unknown as PairedEstatePostureDb, identity),
);
