// BI-FF8A57EF — build one share-safe page of THIS installation's backlog for a
// same-organization peer to mirror. Pure over an injected store so the
// selection policy is unit-tested without a database.
//
// What leaves: every backlog item this install owns, in every status, except
// the local-only sensitivity tiers and rows that are themselves mirrors of a
// peer (those carry the federatedWork origin marker; re-serving them would
// echo a record back to its owner or hand a third install a copy of a copy).

import {
  FEDERATED_WORK_LOCAL_ONLY_SENSITIVITIES,
  FEDERATED_WORK_ORIGIN_MARKER_PREFIX,
  FEDERATED_WORK_SPEC_VERSION,
  hasFederatedWorkOriginMarker,
  type FederatedWorkEpicV1,
  type FederatedWorkItemV1,
  type FederatedWorkPageV1,
} from "@dpf/db/federated-work-contract";

export interface WorkPageItemRow {
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
}

function toItem(row: WorkPageItemRow): FederatedWorkItemV1 {
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
  OR: [{ body: null }, { NOT: { body: { contains: FEDERATED_WORK_ORIGIN_MARKER_PREFIX } } }],
} as const;

export const OWNED_EPIC_WHERE = {
  OR: [{ description: null }, { NOT: { description: { contains: FEDERATED_WORK_ORIGIN_MARKER_PREFIX } } }],
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
    items: pageRows.map(toItem),
    epics: epics.map(toEpic),
    cursor: hasMore && last ? last.itemId : null,
    complete: !hasMore,
  };
}
