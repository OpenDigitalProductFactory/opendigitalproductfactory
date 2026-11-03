// BI-FF8A57EF — same-organization work sync, receiving side.
//
// Every five minutes (with demand reconciliation) this installation pulls the
// share-safe backlog of each trusted same-organization peer and materialises it
// locally as BacklogItem / Epic rows carrying the origin's semantic ids and a
// standalone `[origin:federatedWork:<installationId>:<id>]` marker line.
//
// Only the origin mutates (spec 2026-08-23 §4 invariant 6): each cycle the
// origin's copy overwrites the mirror, so a local edit to a mirrored row is
// undone on the next pull rather than becoming a fork. An id that disappears at
// the origin is retired locally. Provenance stays in FederatedRecordMirror
// (`backlog-item` / `epic`, canonicalSide "peer") so the canonical-side rule
// and the sync-activity read model apply unchanged.
//
// DB-injected so the whole policy runs under unit test with a mock store.

import { createHash } from "node:crypto";

import { prisma } from "@dpf/db";
import {
  FEDERATED_WORK_PAGE_SIZE,
  hasFederatedWorkOriginMarker,
  validateFederatedWorkPageV1,
  withFederatedWorkOriginMarker,
  type FederatedWorkEpicV1,
  type FederatedWorkItemV1,
  type FederatedWorkPageV1,
} from "@dpf/db/federated-work-contract";

import { federationPeerPrincipalId } from "@dpf/db/federation-link-types";

import { CLEAR_DEFERRAL_PROJECTION } from "@/lib/backlog/deferral-contract";
import { bindPeerInstallationIdentity } from "./channel-demand";
import { fetchWorkPageFromPeer, type PeerPostResult } from "./client";
import { relationshipPresetForRole } from "./demand-reconciliation";
import { decryptPeerToken } from "./outbound";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import {
  claimFromMirrorPayload,
  recordFederatedTwins,
  type FederatedWorkClaim,
  type TwinActivityDb,
  type TwinCandidate,
} from "./federated-twins";

/** Hard ceiling on pages per link per cycle: 50 × 500 = 25,000 rows. */
const MAX_PAGES_PER_LINK = 50;

export interface WorkSyncLink {
  linkId: string;
  role: string;
  peerAuthorityUrl: string;
  peerTokenEnc: string | null;
}

export interface WorkSyncMirrorRow {
  mirrorId: string;
  localRecordRef: string | null;
  version: bigint;
  syncStatus: string;
  payload?: unknown;
}

export interface WorkSyncDb {
  federationLink: {
    findMany(args: unknown): Promise<WorkSyncLink[]>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  backlogItem: {
    findUnique(args: unknown): Promise<{ id: string; body: string | null; status: string; deferReason?: string | null } | null>;
    upsert(args: unknown): Promise<{ id: string }>;
    updateMany(args: unknown): Promise<{ count: number }>;
    /** For the twin pass (BI-91FC6B9A); without it twins are not recorded. */
    findMany?(args: unknown): Promise<TwinCandidate[]>;
  };
  /** For the twin pass (BI-91FC6B9A) and status history (BI-C5794F1D); without it neither is recorded. */
  backlogItemActivity?: TwinActivityDb["backlogItemActivity"];
  principal: {
    findUnique(args: unknown): Promise<{ id: string } | null>;
  };
  epic: {
    findUnique(args: unknown): Promise<{ id: string; description: string | null } | null>;
    upsert(args: unknown): Promise<{ id: string }>;
  };
  federatedRecordMirror: {
    findMany(args: unknown): Promise<WorkSyncMirrorRow[]>;
    upsert(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  /** Optional: where the last pull's outcome per link is kept for the health line. */
  platformConfig?: { upsert(args: unknown): Promise<unknown> };
}

/** PlatformConfig key holding the last work-sync outcome per link (EP-ZERO-CONFIG-FEDERATION §5.7). */
export const WORK_SYNC_HEALTH_KEY = "federation.work-sync.health.v1";

export interface WorkSyncHealthRecordV1 {
  schemaVersion: 1;
  observedAt: string;
  links: Array<{ linkId: string; outcome: WorkSyncLinkResult["outcome"]; detail: string | null; lastPullAt: string | null }>;
}

export interface WorkSyncLinkResult {
  linkId: string;
  outcome: "synced" | "fetch-failed" | "invalid-page" | "identity-mismatch" | "no-token";
  detail: string | null;
  pages: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsUnchanged: number;
  itemsRetired: number;
  itemsConflicted: number;
  /** Items the origin parked with nothing attached (BI-9DA5F179). Mirrored as
   *  deferred with the gap written into the reason, owned by the peer principal. */
  itemsDeferredUnattributed: number;
  epicsUpserted: number;
  /** Local items newly recorded as the twin of a pulled mirror (BI-91FC6B9A). */
  twinsRecorded: number;
  /** Mirrors whose status this pull changed, each recorded once in item history (BI-C5794F1D). */
  statusChangesRecorded: number;
}

export interface WorkSyncResult {
  linksChecked: number;
  failedLinks: number;
  links: WorkSyncLinkResult[];
}

export type FetchWorkPage = (
  target: { peerAuthorityUrl: string; linkToken: string; linkId: string; sameOrgLan: boolean },
  options: { cursor: string | null; limit: number },
) => Promise<PeerPostResult>;

export function workMirrorId(linkId: string, recordType: "backlog-item" | "epic", recordId: string): string {
  return `fwm_${createHash("sha256").update(`${linkId}\x00${recordType}\x00${recordId}`).digest("hex").slice(0, 24)}`;
}

function versionOf(updatedAt: string): bigint {
  return BigInt(Math.max(1, Date.parse(updatedAt)));
}

async function upsertEpic(
  db: WorkSyncDb,
  link: WorkSyncLink,
  origin: string,
  epic: FederatedWorkEpicV1,
  now: Date,
): Promise<{ localId: string } | null> {
  const existing = await db.epic.findUnique({ where: { epicId: epic.epicId }, select: { id: true, description: true } });
  // A locally owned epic with the same semantic id is never overwritten — the
  // ids are random, so a clash is a real conflict, not a mirror to refresh.
  if (existing && !hasFederatedWorkOriginMarker(existing.description)) {
    await db.federatedRecordMirror.upsert({
      where: { federationLinkId_recordType_localRecordRef: { federationLinkId: link.linkId, recordType: "epic", localRecordRef: epic.epicId } },
      create: {
        mirrorId: workMirrorId(link.linkId, "epic", epic.epicId), federationLinkId: link.linkId, recordType: "epic",
        canonicalSide: "peer", localRecordRef: epic.epicId, peerRecordRef: `${origin}:${epic.epicId}`,
        syncStatus: "conflict", conflictReason: "local-owned-id", version: versionOf(epic.updatedAt),
        payload: { title: epic.title, status: epic.status, updatedAt: epic.updatedAt },
      },
      update: { syncStatus: "conflict", conflictReason: "local-owned-id", lastSyncedAt: now },
    });
    return null;
  }
  const data = {
    title: epic.title,
    description: withFederatedWorkOriginMarker(epic.description, origin, epic.epicId),
    status: epic.status,
    priority: epic.priority,
    investmentBucket: epic.investmentBucket,
    completedAt: epic.completedAt ? new Date(epic.completedAt) : null,
  };
  const row = await db.epic.upsert({
    where: { epicId: epic.epicId },
    create: { epicId: epic.epicId, createdAt: new Date(epic.createdAt), ...data },
    update: data,
    select: { id: true },
  });
  await db.federatedRecordMirror.upsert({
    where: { federationLinkId_recordType_localRecordRef: { federationLinkId: link.linkId, recordType: "epic", localRecordRef: epic.epicId } },
    create: {
      mirrorId: workMirrorId(link.linkId, "epic", epic.epicId), federationLinkId: link.linkId, recordType: "epic",
      canonicalSide: "peer", localRecordRef: epic.epicId, peerRecordRef: `${origin}:${epic.epicId}`,
      syncStatus: "synced", version: versionOf(epic.updatedAt), acknowledgedVersion: versionOf(epic.updatedAt), lastSyncedAt: now,
      payload: { title: epic.title, status: epic.status, updatedAt: epic.updatedAt },
    },
    update: {
      syncStatus: "synced", conflictReason: null, version: versionOf(epic.updatedAt),
      acknowledgedVersion: versionOf(epic.updatedAt), lastSyncedAt: now,
      payload: { title: epic.title, status: epic.status, updatedAt: epic.updatedAt },
    },
  });
  return { localId: row.id };
}

/** Seven days: the review horizon a mirror gets when the origin shared nothing. */
const UNATTRIBUTED_MIRROR_REVIEW_MS = 7 * 24 * 60 * 60 * 1000;

type MirroredDeferral = {
  projection: Record<string, unknown>;
  unattributed: boolean;
};

/**
 * The deferral projection a mirrored row carries (BI-9DA5F179).
 *
 * Not `deferred` at the origin: the projection is cleared, so an item the
 * origin resumed does not keep a stale park here. Deferred with attribution:
 * the origin's reason, trigger and review date travel verbatim; the owner is
 * the link's federated-peer Principal, because only the origin may change the
 * row and that Principal is how this install names the origin. Deferred with
 * nothing attached: the gap itself becomes the reason — never a bare
 * `deferred` — with a seven-day review so a sweep surfaces it, and the cycle
 * counts it so the health line shows the origin's defect rather than hiding it.
 */
async function mirroredDeferralProjection(
  db: WorkSyncDb,
  link: WorkSyncLink,
  origin: string,
  item: FederatedWorkItemV1,
  now: Date,
): Promise<MirroredDeferral> {
  if (item.status !== "deferred") return { projection: { ...CLEAR_DEFERRAL_PROJECTION }, unattributed: false };
  const owner = await db.principal.findUnique({
    where: { principalId: federationPeerPrincipalId(link.linkId) },
    select: { id: true },
  });
  const deferOwnerPrincipalId = owner?.id ?? null;
  if (item.deferral) {
    return {
      unattributed: false,
      projection: {
        deferReason: item.deferral.reason,
        deferTrigger: item.deferral.trigger,
        deferReviewAt: new Date(item.deferral.reviewAt),
        deferredAt: item.deferral.deferredAt ? new Date(item.deferral.deferredAt) : now,
        deferOwnerPrincipalId,
      },
    };
  }
  return {
    unattributed: true,
    projection: {
      deferReason: `Parked at origin installation ${origin}, which shared no reason, trigger or review date for the deferral.`,
      deferTrigger: "The origin publishes an attributable deferral (reason, trigger, review date) or resumes the item; the next work-sync cycle carries it.",
      deferReviewAt: new Date(now.getTime() + UNATTRIBUTED_MIRROR_REVIEW_MS),
      deferredAt: now,
      deferOwnerPrincipalId,
    },
  };
}

function mirrorPayload(item: FederatedWorkItemV1) {
  return { title: item.title, status: item.status, updatedAt: item.updatedAt, ...(item.claim ? { claim: item.claim } : {}) };
}

/**
 * One history row when a pull changes a mirror's status (BI-C5794F1D). The
 * origin made the change; this install only carries it, so the actor is the
 * link's federated-peer Principal and the row says where it came from. Without
 * it a status the origin moved (or a local edit the pull undid) changes with no
 * trace. Written only on an actual change, never for an unchanged row.
 */
async function recordMirrorStatusChange(
  db: WorkSyncDb,
  link: WorkSyncLink,
  origin: string,
  change: { backlogItemId: string; itemId: string; from: string; to: string },
  now: Date,
): Promise<boolean> {
  if (!db.backlogItemActivity || change.from === change.to) return false;
  const peer = await db.principal.findUnique({
    where: { principalId: federationPeerPrincipalId(link.linkId) },
    select: { id: true },
  });
  await db.backlogItemActivity.create({
    data: {
      backlogItemId: change.backlogItemId,
      kind: "status_change",
      summary: `${change.from} → ${change.to} — work sync from installation ${origin}, which owns ${change.itemId}`,
      payload: {
        from: change.from,
        to: change.to,
        source: "federated-work-sync",
        originInstallationId: origin,
        federationLinkId: link.linkId,
        actorPrincipalId: peer?.id ?? null,
        observedAt: now.toISOString(),
      },
    },
  });
  return true;
}

function sameClaim(a: FederatedWorkClaim | null, b: FederatedWorkClaim | null): boolean {
  if (!a || !b) return a === b;
  return a.active === b.active && a.since === b.since && a.workrooms === b.workrooms;
}

async function upsertItem(
  db: WorkSyncDb,
  link: WorkSyncLink,
  origin: string,
  item: FederatedWorkItemV1,
  epicLocalIds: ReadonlyMap<string, string>,
  known: ReadonlyMap<string, WorkSyncMirrorRow>,
  now: Date,
): Promise<{ outcome: "created" | "updated" | "unchanged" | "conflict" | "deferred-unattributed"; statusChanged: boolean }> {
  const mirrorWhere = { federationLinkId_recordType_localRecordRef: { federationLinkId: link.linkId, recordType: "backlog-item", localRecordRef: item.itemId } };
  const version = versionOf(item.updatedAt);
  const prior = known.get(item.itemId);
  const existing = await db.backlogItem.findUnique({
    where: { itemId: item.itemId },
    select: { id: true, body: true, status: true, deferReason: true },
  });

  if (existing && !hasFederatedWorkOriginMarker(existing.body)) {
    await db.federatedRecordMirror.upsert({
      where: mirrorWhere,
      create: {
        mirrorId: workMirrorId(link.linkId, "backlog-item", item.itemId), federationLinkId: link.linkId, recordType: "backlog-item",
        canonicalSide: "peer", localRecordRef: item.itemId, peerRecordRef: `${origin}:${item.itemId}`,
        syncStatus: "conflict", conflictReason: "local-owned-id", version,
        payload: { title: item.title, status: item.status, updatedAt: item.updatedAt },
      },
      update: { syncStatus: "conflict", conflictReason: "local-owned-id", lastSyncedAt: now },
    });
    return { outcome: "conflict", statusChanged: false };
  }

  // Unchanged at the origin AND still present locally as a mirror: nothing to
  // write. (A mirror row whose local item vanished is re-created below.) A
  // mirror parked bare — `deferred` with no reason — is never "unchanged": it
  // is the 2026-09-02 defect on disk, and the next cycle repairs it.
  const parkedBare = existing?.status === "deferred" && !existing.deferReason;
  // A claim taken or released at the origin need not touch the origin row's
  // updatedAt (a Workroom opening does not), so it is compared on its own.
  const claimChanged = !sameClaim(claimFromMirrorPayload(prior?.payload), item.claim ?? null);
  if (existing && !parkedBare && !claimChanged && prior && prior.syncStatus === "synced" && prior.version === version) return { outcome: "unchanged", statusChanged: false };

  const deferral = await mirroredDeferralProjection(db, link, origin, item, now);
  const data = {
    title: item.title,
    status: item.status,
    ...deferral.projection,
    type: item.type,
    body: withFederatedWorkOriginMarker(item.body, origin, item.itemId),
    priority: item.priority,
    workType: item.workType,
    triageOutcome: item.triageOutcome,
    effortSize: item.effortSize,
    proposedOutcome: item.proposedOutcome,
    resolution: item.resolution,
    sensitivity: item.sensitivity,
    source: item.source,
    occurrenceCount: item.occurrenceCount,
    scopeKind: item.scopeKind,
    archetypeCategories: item.archetypeCategories,
    archetypeIds: item.archetypeIds,
    lifecycleTags: item.lifecycleTags,
    completedAt: item.completedAt ? new Date(item.completedAt) : null,
    epicId: item.epicId ? (epicLocalIds.get(item.epicId) ?? null) : null,
  };
  await db.backlogItem.upsert({
    where: { itemId: item.itemId },
    create: { itemId: item.itemId, createdAt: new Date(item.createdAt), ...data },
    update: data,
    select: { id: true },
  });
  await db.federatedRecordMirror.upsert({
    where: mirrorWhere,
    create: {
      mirrorId: workMirrorId(link.linkId, "backlog-item", item.itemId), federationLinkId: link.linkId, recordType: "backlog-item",
      canonicalSide: "peer", localRecordRef: item.itemId, peerRecordRef: `${origin}:${item.itemId}`,
      syncStatus: "synced", version, acknowledgedVersion: version, lastSyncedAt: now,
      payload: mirrorPayload(item),
    },
    update: {
      syncStatus: "synced", conflictReason: null, version, acknowledgedVersion: version, lastSyncedAt: now,
      payload: mirrorPayload(item),
    },
  });
  let statusChanged = false;
  if (existing) {
    try {
      statusChanged = await recordMirrorStatusChange(db, link, origin, { backlogItemId: existing.id, itemId: item.itemId, from: existing.status, to: item.status }, now);
    } catch (error) {
      // History is best-effort; the mirror itself is already current.
      console.warn(`[work-sync] status history for ${item.itemId} skipped: ${getErrorMessage(error)}`);
    }
  }
  if (deferral.unattributed) return { outcome: "deferred-unattributed", statusChanged };
  return { outcome: existing ? "updated" : "created", statusChanged };
}

async function syncLink(
  db: WorkSyncDb,
  link: WorkSyncLink,
  deps: { fetchPage: FetchWorkPage; decryptToken: typeof decryptPeerToken; now: Date },
): Promise<WorkSyncLinkResult> {
  const result: WorkSyncLinkResult = {
    linkId: link.linkId, outcome: "synced", detail: null, pages: 0,
    itemsCreated: 0, itemsUpdated: 0, itemsUnchanged: 0, itemsRetired: 0, itemsConflicted: 0, itemsDeferredUnattributed: 0, epicsUpserted: 0, twinsRecorded: 0, statusChangesRecorded: 0,
  };
  const token = deps.decryptToken(link.peerTokenEnc);
  if (!token) return { ...result, outcome: "no-token", detail: "This link holds no peer-issued token." };

  // Pull the complete inventory first; only a COMPLETE read may retire.
  const pages: FederatedWorkPageV1[] = [];
  let cursor: string | null = null;
  for (let index = 0; index < MAX_PAGES_PER_LINK; index++) {
    const response = await deps.fetchPage(
      { peerAuthorityUrl: link.peerAuthorityUrl, linkToken: token, linkId: link.linkId, sameOrgLan: link.role === "same-org-peer" },
      { cursor, limit: FEDERATED_WORK_PAGE_SIZE },
    );
    if (!response.ok) {
      const detail = response.status === 404
        ? "Peer does not serve work sync yet (upgrade the peer)."
        : `Peer responded ${response.status}${response.error ? `: ${response.error}` : ""}`;
      return { ...result, outcome: "fetch-failed", detail, pages: pages.length };
    }
    const violations = validateFederatedWorkPageV1(response.body);
    if (violations.length > 0) {
      return { ...result, outcome: "invalid-page", detail: violations.slice(0, 5).join(", "), pages: pages.length };
    }
    const page = response.body as FederatedWorkPageV1;
    pages.push(page);
    if (page.complete) break;
    cursor = page.cursor;
  }
  const origin = pages[0]?.originInstallationId;
  if (!origin) return { ...result, outcome: "invalid-page", detail: "Peer returned no page." };
  const complete = pages[pages.length - 1]?.complete === true;

  try {
    await bindPeerInstallationIdentity(db, link.linkId, origin);
  } catch (error) {
    return { ...result, outcome: "identity-mismatch", detail: getErrorMessage(error), pages: pages.length };
  }

  const known = new Map<string, WorkSyncMirrorRow>();
  for (const row of await db.federatedRecordMirror.findMany({
    where: { federationLinkId: link.linkId, recordType: "backlog-item", canonicalSide: "peer" },
    select: { mirrorId: true, localRecordRef: true, version: true, syncStatus: true, payload: true },
  })) {
    if (row.localRecordRef) known.set(row.localRecordRef, row);
  }

  const epicLocalIds = new Map<string, string>();
  for (const epic of pages.flatMap((page) => page.epics)) {
    try {
      const upserted = await upsertEpic(db, link, origin, epic, deps.now);
      if (upserted) {
        epicLocalIds.set(epic.epicId, upserted.localId);
        result.epicsUpserted++;
      }
    } catch (error) {
      console.warn(`[work-sync] epic ${epic.epicId} from ${link.linkId} skipped: ${getErrorMessage(error)}`);
    }
  }

  const seen = new Set<string>();
  for (const item of pages.flatMap((page) => page.items)) {
    seen.add(item.itemId);
    try {
      const { outcome, statusChanged } = await upsertItem(db, link, origin, item, epicLocalIds, known, deps.now);
      if (statusChanged) result.statusChangesRecorded++;
      if (outcome === "created") result.itemsCreated++;
      else if (outcome === "updated") result.itemsUpdated++;
      else if (outcome === "unchanged") result.itemsUnchanged++;
      else if (outcome === "deferred-unattributed") result.itemsDeferredUnattributed++;
      else result.itemsConflicted++;
    } catch (error) {
      // Fault-isolate: one bad row must not strand the rest of the inventory.
      console.warn(`[work-sync] item ${item.itemId} from ${link.linkId} skipped: ${getErrorMessage(error)}`);
    }
  }

  // Record each pulled mirror as the twin of this install's own same-origin
  // items. Unchanged mirrors included: the first cycle backfills (BI-91FC6B9A).
  if (db.backlogItem.findMany && db.backlogItemActivity) {
    const pulled = pages.flatMap((page) => page.items).map((item) => ({
      itemId: item.itemId,
      peerStatus: item.status,
      body: withFederatedWorkOriginMarker(item.body, origin, item.itemId),
    }));
    try {
      result.twinsRecorded = await recordFederatedTwins(
        { backlogItem: { findMany: db.backlogItem.findMany.bind(db.backlogItem) }, backlogItemActivity: db.backlogItemActivity },
        pulled,
        deps.now,
      );
    } catch (error) {
      console.warn(`[work-sync] twin pass for ${link.linkId} skipped: ${getErrorMessage(error)}`);
    }
  }

  if (complete) {
    const missing = [...known.entries()]
      .filter(([itemId, row]) => !seen.has(itemId) && row.syncStatus === "synced")
      .map(([itemId]) => itemId);
    if (missing.length > 0) {
      const retireWhere = { itemId: { in: missing }, body: { contains: `[origin:federatedWork:${origin}:` }, status: { notIn: ["done", "retired"] } };
      // Read what is about to retire so each status change lands in history (BI-C5794F1D).
      const retiring = db.backlogItem.findMany && db.backlogItemActivity
        ? await db.backlogItem.findMany({ where: retireWhere, select: { id: true, itemId: true, status: true } }) as Array<{ id: string; itemId: string; status: string }>
        : [];
      const retired = await db.backlogItem.updateMany({
        where: retireWhere,
        data: { status: "retired", resolution: "Removed at the origin installation.", completedAt: deps.now },
      });
      for (const row of retiring) {
        try {
          if (await recordMirrorStatusChange(db, link, origin, { backlogItemId: row.id, itemId: row.itemId, from: row.status, to: "retired" }, deps.now)) {
            result.statusChangesRecorded++;
          }
        } catch (error) {
          console.warn(`[work-sync] retirement history for ${row.itemId} skipped: ${getErrorMessage(error)}`);
        }
      }
      await db.federatedRecordMirror.updateMany({
        where: { federationLinkId: link.linkId, recordType: "backlog-item", localRecordRef: { in: missing } },
        data: { syncStatus: "withdrawn", lastSyncedAt: deps.now },
      });
      result.itemsRetired = retired.count;
    }
  } else {
    result.detail = `Inventory exceeded ${MAX_PAGES_PER_LINK} pages; nothing retired this cycle.`;
  }
  result.pages = pages.length;
  return result;
}

/**
 * Pull every trusted same-organization peer's backlog into local mirrors.
 * Runs on the demand-reconciliation cadence; never throws for one link's sake.
 */
export async function runWorkSync(
  db: WorkSyncDb = prisma as unknown as WorkSyncDb,
  deps: { fetchPage?: FetchWorkPage; decryptToken?: typeof decryptPeerToken; now?: Date } = {},
): Promise<WorkSyncResult> {
  const now = deps.now ?? new Date();
  const fetchPage: FetchWorkPage = deps.fetchPage
    ?? ((target, options) => fetchWorkPageFromPeer(target, { cursor: options.cursor, limit: options.limit }));
  const decryptToken = deps.decryptToken ?? decryptPeerToken;
  const links = (await db.federationLink.findMany({
    where: { linkState: "trusted", revokedAt: null, quarantinedAt: null },
    select: { linkId: true, role: true, peerAuthorityUrl: true, peerTokenEnc: true },
  })).filter((link) => relationshipPresetForRole(link.role) === "same-organization");

  const results: WorkSyncLinkResult[] = [];
  for (const link of links) {
    try {
      results.push(await syncLink(db, link, { fetchPage, decryptToken, now }));
    } catch (error) {
      results.push({
        linkId: link.linkId, outcome: "fetch-failed", detail: getErrorMessage(error), pages: 0,
        itemsCreated: 0, itemsUpdated: 0, itemsUnchanged: 0, itemsRetired: 0, itemsConflicted: 0, itemsDeferredUnattributed: 0, epicsUpserted: 0, twinsRecorded: 0, statusChangesRecorded: 0,
      });
    }
  }
  const failed = results.filter((r) => r.outcome !== "synced");
  for (const r of results) {
    console.log(`[work-sync] ${r.linkId} ${r.outcome} pages=${r.pages} created=${r.itemsCreated} updated=${r.itemsUpdated} unchanged=${r.itemsUnchanged} retired=${r.itemsRetired} conflicts=${r.itemsConflicted} deferredUnattributed=${r.itemsDeferredUnattributed} epics=${r.epicsUpserted} twins=${r.twinsRecorded} statusChanges=${r.statusChangesRecorded}${r.detail ? ` — ${r.detail}` : ""}`);
  }
  // Remember what each pull reported so the health line can say WHY, not only when.
  if (db.platformConfig) {
    const record: WorkSyncHealthRecordV1 = {
      schemaVersion: 1,
      observedAt: now.toISOString(),
      links: results.map((r) => ({ linkId: r.linkId, outcome: r.outcome, detail: r.detail, lastPullAt: r.outcome === "synced" ? now.toISOString() : null })),
    };
    try {
      await db.platformConfig.upsert({ where: { key: WORK_SYNC_HEALTH_KEY }, create: { key: WORK_SYNC_HEALTH_KEY, value: record }, update: { value: record } });
    } catch (error) {
      console.warn(`[work-sync] could not record health: ${getErrorMessage(error)}`);
    }
  }
  return { linksChecked: results.length, failedLinks: failed.length, links: results };
}
