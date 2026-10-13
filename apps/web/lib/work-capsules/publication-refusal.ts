// Review-bound Workroom statuses (ready-for-review, ready-for-promotion,
// complete) pass the failure-readiness publication boundary. A refusal there
// used to reach MCP callers as a bare throw ("tool_threw: Workroom source
// identity is missing.") with no repair step (BI-023EF164). This module turns
// the boundary's closed refusal code into a typed error for the store and a
// structured tool result for the handler.

import type { ToolResult } from "@/lib/mcp-tool-types";

import { WorkCapsulePublicationRefusedError, type DeliveredCloseout } from "./work-capsule-terminal-status";

const REVIEW_BOUND_STATUSES = new Set(["ready-for-review", "ready-for-promotion", "complete"]);

/**
 * Throw a typed refusal when a repository-backed room asks for a review-bound
 * status it cannot yet publish. Rooms without a repository and non-review
 * statuses pass through untouched.
 */
export async function assertWorkroomPublishable(input: {
  capsuleId: string;
  status: string;
  repositoryFullName: string | null;
  pullRequestNumber?: number | null;
  backlogItemId?: string | null;
  backlogItem?: { findFirst(args: unknown): Promise<{ itemId: string; status: string } | null> };
}): Promise<void> {
  if (!input.repositoryFullName || !REVIEW_BOUND_STATUSES.has(input.status)) return;
  const { checkWorkroomFailureReadiness } = await import("@/lib/change-review/failure-readiness-publication");
  const readiness = await checkWorkroomFailureReadiness(input.capsuleId);
  if (readiness.mayPublish) return;
  const deliveredCloseout = readiness.code === "failure_review_required" && input.status === "complete"
    ? await resolveDeliveredCloseout(input)
    : null;
  throw new WorkCapsulePublicationRefusedError({ ...readiness, ...(deliveredCloseout ? { deliveredCloseout } : {}) });
}

/**
 * BI-C9912C22 AC-2. The failure review gates publication of an unpublished
 * change. Once the room's PR is bound and its item is done, satisfying it would
 * mean re-gating merged code, which protects nothing (WC-BFDF763B, 2026-10-02).
 * The boundary still refuses `complete`; this only finds the delivered
 * close-out the refusal can name instead.
 */
async function resolveDeliveredCloseout(input: Parameters<typeof assertWorkroomPublishable>[0]): Promise<DeliveredCloseout | null> {
  if (!input.pullRequestNumber || !input.backlogItemId || !input.backlogItem) return null;
  // Build Studio rooms store the item's row id, CLI rooms its itemId (BI-62FB6505).
  const item = await input.backlogItem.findFirst({
    where: { OR: [{ itemId: input.backlogItemId }, { id: input.backlogItemId }] },
    select: { itemId: true, status: true },
  });
  if (item?.status !== "done") return null;
  return { backlogItemId: item.itemId, pullRequestNumber: input.pullRequestNumber, status: "archived" };
}

/** The MCP answer for a refusal: the code, the reason, and what to do next. */
export function publicationRefusedToolResult(
  error: Pick<WorkCapsulePublicationRefusedError, "code" | "reason" | "deliveredCloseout">,
  input: { capsuleId: string; status: string },
): ToolResult {
  const delivered = error.deliveredCloseout;
  return {
    success: false,
    error: error.code,
    message: error.reason,
    data: {
      capsuleId: input.capsuleId,
      requestedStatus: input.status,
      ...(delivered ? { deliveredCloseout: delivered } : {}),
      nextAction: delivered
        ? `This room is delivered: PR #${delivered.pullRequestNumber} is bound and ${delivered.backlogItemId} is done. `
          + "The failure review gates publication of unpublished changes, so do not re-gate merged code. "
          + `Close it as delivered with update_workroom_status status "archived" and a reason naming the merge and the done item, `
          + "as the Workroom reaper does for merged rooms."
        : error.code === "workroom_identity_incomplete"
        ? "Call adopt_worktree with repositoryFullName, headBranch, worktreePath, baseSha and headSha for this room, then retry update_workroom_status."
        : "Request an independent failure review of the current head (review_semantic_change) and retry once its receipt is recorded.",
    },
  };
}
