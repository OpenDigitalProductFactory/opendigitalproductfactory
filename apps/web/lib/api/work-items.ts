// apps/web/lib/api/work-items.ts
//
// Pure projection + transition logic for the field "My Jobs" surface
// (BI-MOBAPP-FIELD). Projects WorkItem rows into the shared wire DTOs and
// validates the field check-in/out status transitions. No DB / no I/O — unit
// tested in work-items.test.ts; the routes own the Prisma calls.

import type {
  WorkItemStatus,
  WorkItemSummary,
  WorkItemDetail,
} from "@dpf/types";

/** Subset of WorkItem the routes select. Detail fields are optional. */
export interface WorkItemRow {
  itemId: string;
  title: string;
  status: string;
  urgency: string;
  effortClass: string;
  dueAt: Date | null;
  queueId: string;
  teamId: string | null;
  createdAt: Date;
  // detail-only
  description?: string;
  sourceType?: string;
  sourceId?: string | null;
  assignedToUserId?: string | null;
  claimedAt?: Date | null;
  completedAt?: Date | null;
}

const STATUSES: readonly WorkItemStatus[] = [
  "queued",
  "claimed",
  "in-progress",
  "completed",
];

export function isWorkItemStatus(v: unknown): v is WorkItemStatus {
  return typeof v === "string" && (STATUSES as readonly string[]).includes(v);
}

/**
 * Allowed field transitions (the check-in/out flow):
 *  queued -> claimed        (accept the job)
 *  claimed -> in-progress   (check in / start)
 *  claimed -> queued        (release back to the queue)
 *  in-progress -> completed (check out / finish)
 *  in-progress -> claimed   (pause)
 * `completed` is terminal.
 */
const ALLOWED: Record<WorkItemStatus, readonly WorkItemStatus[]> = {
  queued: ["claimed"],
  claimed: ["in-progress", "queued"],
  "in-progress": ["completed", "claimed"],
  completed: [],
};

export function isValidWorkItemTransition(
  from: WorkItemStatus,
  to: WorkItemStatus,
): boolean {
  if (from === to) return false;
  return ALLOWED[from]?.includes(to) ?? false;
}

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function statusOf(raw: string): WorkItemStatus {
  return isWorkItemStatus(raw) ? raw : "queued";
}

export function toWorkItemSummary(row: WorkItemRow): WorkItemSummary {
  return {
    itemId: row.itemId,
    title: row.title,
    status: statusOf(row.status),
    urgency: row.urgency,
    effortClass: row.effortClass,
    dueAt: iso(row.dueAt),
    queueId: row.queueId,
    teamId: row.teamId ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toWorkItemDetail(row: WorkItemRow): WorkItemDetail {
  return {
    ...toWorkItemSummary(row),
    description: row.description ?? "",
    sourceType: row.sourceType ?? "",
    sourceId: row.sourceId ?? null,
    assignedToUserId: row.assignedToUserId ?? null,
    claimedAt: iso(row.claimedAt),
    completedAt: iso(row.completedAt),
  };
}

/** Prisma update payload for a transition; stamps claimedAt/completedAt. `now` is injected to keep this pure. */
export function statusUpdateData(
  to: WorkItemStatus,
  now: Date,
): { status: WorkItemStatus; claimedAt?: Date; completedAt?: Date } {
  const data: { status: WorkItemStatus; claimedAt?: Date; completedAt?: Date } =
    { status: to };
  if (to === "claimed") data.claimedAt = now;
  if (to === "completed") data.completedAt = now;
  return data;
}
