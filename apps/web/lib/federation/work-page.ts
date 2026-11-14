// BI-FF8A57EF — build one share-safe page of THIS installation's backlog for a
// same-organization peer to mirror. Pure over an injected store so the
// selection policy is unit-tested without a database.
//
// What leaves: every backlog item this install owns, in every status, except
// the local-only sensitivity tiers and rows that are themselves mirrors of a
// peer (those carry the federatedWork origin marker; re-serving them would
// echo a record back to its owner or hand a third install a copy of a copy).

import { claimHolderOf, isLapsedPeerClaim } from "./work-claim-ref";
import {
  FEDERATED_WORK_LOCAL_ONLY_SENSITIVITIES,
  FEDERATED_WORK_ORIGIN_MARKER_SQL_PREFIX,
  FEDERATED_WORK_SPEC_VERSION,
  hasFederatedWorkOriginMarker,
  type FederatedWorkClaimHolderV1,
  type FederatedWorkClaimV1,
  type FederatedWorkDeferralV1,
  type FederatedWorkEpicV1,
  type FederatedWorkItemV1,
  type FederatedWorkPageV1,
} from "@dpf/db/federated-work-contract";

export interface WorkPageItemRow {
  id?: string;
  itemId: string;
  title: string;
  status: string;
  type: string;
  body: string | null;
  priority: number | null;
  workType: string | null;
  triageOutcome: string | null;
  effortSize: string | null;
  proposedOutcome: string | null;
  resolution: string | null;
  sensitivity: string;
  source: string | null;
  occurrenceCount: number;
  scopeKind: string | null;
  archetypeCategories: string[];
  archetypeIds: string[];
  lifecycleTags: string[];
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  deferReason: string | null;
  deferTrigger: string | null;
  deferReviewAt: Date | null;
  deferredAt: Date | null;
  claimStatus?: string | null;
  claimedAt?: Date | null;
  epic: { epicId: string } | null;
}

export interface WorkPageEpicRow {
  epicId: string;
  title: string;
  description: string | null;
  status: string;
  priority: number | null;
  investmentBucket: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export interface WorkPageDb {
  backlogItem: { findMany(args: unknown): Promise<WorkPageItemRow[]> };
  epic: { findMany(args: unknown): Promise<WorkPageEpicRow[]> };
  /** Live Workrooms, so a peer can see work in flight (BI-91FC6B9A). */
  workroom?: { findMany(args: unknown): Promise<WorkPageWorkroomRow[]> };
}

export interface WorkPageWorkroomRow {
  backlogItemId: string | null;
  capsuleId?: string;
  executorKind?: string | null;
  executorRef?: string | null;
  leaseExpiresAt?: Date | null;
  createdAt?: Date;
}

/** Live Workrooms on one served item: how many, and who holds the claim. */
interface ItemWorkrooms {
  count: number;
  holder: FederatedWorkClaimHolderV1 | null;
}

/** Mirrors TERMINAL_CAPSULE_STATUSES (apps/web/lib/build/unified-wip-query.ts). */
const TERMINAL_WORKROOM_STATUSES = ["complete", "abandoned", "archived"] as const;

function toItem(row: WorkPageItemRow, liveWorkrooms: ItemWorkrooms): FederatedWorkItemV1 {
  return {
    itemId: row.itemId,
    title: row.title,
    status: row.status,
    type: row.type,
    body: row.body,
    priority: row.priority,
    workType: row.workType,
    triageOutcome: row.triageOutcome,
    effortSize: row.effortSize,
    proposedOutcome: row.proposedOutcome,
    resolution: row.resolution,
    sensitivity: row.sensitivity,
    epicId: row.epic?.epicId ?? null,
    source: row.source,
    occurrenceCount: row.occurrenceCount,
    scopeKind: row.scopeKind,
    archetypeCategories: row.archetypeCategories,
    archetypeIds: row.archetypeIds,
    lifecycleTags: row.lifecycleTags,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    deferral: toDeferral(row),
    claim: toClaim(row, liveWorkrooms),
  };
}

function toClaim(row: WorkPageItemRow, liveWorkrooms: ItemWorkrooms): FederatedWorkClaimV1 {
  const held = row.claimStatus === "active";
  return {
    active: held || liveWorkrooms.count > 0,
    since: held ? (row.claimedAt?.toISOString() ?? null) : null,
    workrooms: liveWorkrooms.count,
    holder: liveWorkrooms.holder,
  };
}

function holderOf(room: WorkPageWorkroomRow, selfInstallationId: string): FederatedWorkClaimHolderV1 | null {
  if (!room.capsuleId) return null;
  return claimHolderOf({
    capsuleId: room.capsuleId,
    executorKind: room.executorKind ?? null,
    executorRef: room.executorRef ?? null,
    leaseExpiresAt: room.leaseExpiresAt ?? null,
  }, selfInstallationId);
}

/** Live Workrooms per served item, and the oldest one as the claim holder. A
 *  Workroom names its item by semantic id or row id, so both are matched;
 *  results key on the semantic id. */
async function liveWorkroomsByItem(
  db: WorkPageDb,
  rows: readonly WorkPageItemRow[],
  selfInstallationId: string,
  now: Date,
): Promise<Map<string, ItemWorkrooms>> {
  const byItem = new Map<string, ItemWorkrooms>();
  if (!db.workroom || rows.length === 0) return byItem;
  const bySemanticOrRowId = new Map<string, string>();
  for (const row of rows) {
    bySemanticOrRowId.set(row.itemId, row.itemId);
    if (row.id) bySemanticOrRowId.set(row.id, row.itemId);
  }
  for (const room of await db.workroom.findMany({
    where: { backlogItemId: { in: [...bySemanticOrRowId.keys()] }, status: { notIn: [...TERMINAL_WORKROOM_STATUSES] } },
    orderBy: [{ createdAt: "asc" }, { capsuleId: "asc" }],
    select: { backlogItemId: true, capsuleId: true, executorKind: true, executorRef: true, leaseExpiresAt: true, createdAt: true },
  })) {
    const itemId = room.backlogItemId ? bySemanticOrRowId.get(room.backlogItemId) : undefined;
    if (!itemId) continue;
    // A claim held for a peer that stopped renewing no longer holds the item:
    // publishing it would keep every installation from taking the item over.
    if (isLapsedPeerClaim({ executorKind: room.executorKind ?? null, leaseExpiresAt: room.leaseExpiresAt ?? null }, now)) continue;
    const current = byItem.get(itemId) ?? { count: 0, holder: null };
    byItem.set(itemId, { count: current.count + 1, holder: current.holder ?? holderOf(room, selfInstallationId) });
  }
  return byItem;
}

/** Publish the deferral only when it is attributable (BI-9DA5F179). A parked
 *  row missing any of reason / trigger / review date ships `null` so the peer
 *  reports the gap instead of mirroring a bare `deferred`. */
function toDeferral(row: WorkPageItemRow): FederatedWorkDeferralV1 | null {
  if (row.status !== "deferred") return null;
  if (!row.deferReason || !row.deferTrigger || !row.deferReviewAt) return null;
  return {
    reason: row.deferReason,
    trigger: row.deferTrigger,
    reviewAt: row.deferReviewAt.toISOString(),
    deferredAt: row.deferredAt?.toISOString() ?? null,
  };
}

function toEpic(row: WorkPageEpicRow): FederatedWorkEpicV1 {
  return {
    epicId: row.epicId,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    investmentBucket: row.investmentBucket,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

/**
 * Where-clause shared by every reader that must skip mirrored rows. The prose
 * columns are nullable, and `NOT (col LIKE …)` is NULL — not true — for a NULL
 * column, so a bare NOT-contains silently dropped every row that had no prose
 * (29 production epics and 8 development epics never crossed). A row with no
 * prose cannot carry a marker and is owned.
 */
export const OWNED_BACKLOG_WHERE = {
  sensitivity: { notIn: [...FEDERATED_WORK_LOCAL_ONLY_SENSITIVITIES] },
  OR: [{ body: null }, { NOT: { body: { contains: FEDERATED_WORK_ORIGIN_MARKER_SQL_PREFIX } } }],
} as const;

export const OWNED_EPIC_WHERE = {
  OR: [{ description: null }, { NOT: { description: { contains: FEDERATED_WORK_ORIGIN_MARKER_SQL_PREFIX } } }],
} as const;

export async function buildFederatedWorkPage(
  db: WorkPageDb,
  input: { originInstallationId: string; cursor: string | null; limit: number; now?: Date },
): Promise<FederatedWorkPageV1> {
  const rows = await db.backlogItem.findMany({
    where: {
      ...OWNED_BACKLOG_WHERE,
      ...(input.cursor ? { itemId: { gt: input.cursor } } : {}),
    },
    orderBy: { itemId: "asc" },
    take: input.limit + 1,
    select: {
      itemId: true, title: true, status: true, type: true, body: true, priority: true,
      workType: true, triageOutcome: true, effortSize: true, proposedOutcome: true,
      resolution: true, sensitivity: true, source: true, occurrenceCount: true,
      scopeKind: true, archetypeCategories: true, archetypeIds: true, lifecycleTags: true,
      createdAt: true, updatedAt: true, completedAt: true,
      deferReason: true, deferTrigger: true, deferReviewAt: true, deferredAt: true,
      id: true, claimStatus: true, claimedAt: true,
      epic: { select: { epicId: true } },
    },
  });
  // Defence in depth: the SQL predicate is a substring match; the marker rule
  // is a standalone line. Re-check so prose that merely mentions the marker is
  // still served and a real marker is never served.
  const hasMore = rows.length > input.limit;
  const considered = hasMore ? rows.slice(0, input.limit) : rows;
  const pageRows = considered.filter((row) => !hasFederatedWorkOriginMarker(row.body));
  // The cursor is the last row CONSIDERED, served or filtered, so a filtered
  // tail never makes the next page re-read or skip a row.
  const last = considered[considered.length - 1];
  const workrooms = await liveWorkroomsByItem(db, pageRows, input.originInstallationId, input.now ?? new Date());

  const epics = input.cursor
    ? []
    : (await db.epic.findMany({
        where: OWNED_EPIC_WHERE,
        orderBy: { epicId: "asc" },
        select: {
          epicId: true, title: true, description: true, status: true, priority: true,
          investmentBucket: true, createdAt: true, updatedAt: true, completedAt: true,
        },
      })).filter((epic) => !hasFederatedWorkOriginMarker(epic.description));

  return {
    specVersion: FEDERATED_WORK_SPEC_VERSION,
    originInstallationId: input.originInstallationId,
    generatedAt: (input.now ?? new Date()).toISOString(),
    items: pageRows.map((row) => toItem(row, workrooms.get(row.itemId) ?? { count: 0, holder: null })),
    epics: epics.map(toEpic),
    cursor: hasMore && last ? last.itemId : null,
    complete: !hasMore,
  };
}
