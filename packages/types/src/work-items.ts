/**
 * Work-item (field "My Jobs") wire types — shared by the portal producer
 * (apps/web/app/api/v1/work-items) and the mobile field surface
 * (apps/mobile/src/features/jobs). Projection of the WorkItem model.
 * See EP-MOBILE-ARCHETYPE / BI-MOBAPP-FIELD.
 */

export type WorkItemStatus =
  | "queued"
  | "claimed"
  | "in-progress"
  | "completed";

/** Compact work item for the field job list. Dates are ISO strings. */
export interface WorkItemSummary {
  itemId: string;
  title: string;
  status: WorkItemStatus;
  urgency: string;
  effortClass: string;
  dueAt: string | null;
  queueId: string;
  teamId: string | null;
  createdAt: string;
}

/** Full work item for the job detail screen. */
export interface WorkItemDetail extends WorkItemSummary {
  description: string;
  sourceType: string;
  sourceId: string | null;
  assignedToUserId: string | null;
  claimedAt: string | null;
  completedAt: string | null;
}

/** Body for a field check-in/out status transition. */
export interface WorkItemStatusUpdateRequest {
  status: WorkItemStatus;
}
