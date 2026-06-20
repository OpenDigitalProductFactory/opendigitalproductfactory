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

/**
 * Resolved customer link for a WorkItem — when the source row points at one.
 * `accountId` is the public-id string (`ACC-…`), the same value the invoice
 * create endpoint expects in its `accountId` field, so the mobile billing
 * screen can pre-fill the customer without a separate lookup.
 */
export interface WorkItemAccount {
  /** Internal CustomerAccount.id (cuid). */
  id: string;
  /** Public CustomerAccount.accountId — the value finance APIs accept. */
  accountId: string;
  name: string;
}

/** Full work item for the job detail screen. */
export interface WorkItemDetail extends WorkItemSummary {
  description: string;
  sourceType: string;
  sourceId: string | null;
  assignedToUserId: string | null;
  claimedAt: string | null;
  completedAt: string | null;
  /**
   * Customer this job is for, resolved server-side from the source row when
   * possible (Engagement / Opportunity / StorefrontBooking links). Null when
   * the source can't be mapped — the field tech must enter the account on
   * the invoice screen.
   */
  account: WorkItemAccount | null;
}

/** Body for a field check-in/out status transition. */
export interface WorkItemStatusUpdateRequest {
  status: WorkItemStatus;
}
