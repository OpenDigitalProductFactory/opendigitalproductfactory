// Review-bound Workroom statuses (ready-for-review, ready-for-promotion,
// complete) pass the failure-readiness publication boundary. A refusal there
// used to reach MCP callers as a bare throw ("tool_threw: Workroom source
// identity is missing.") with no repair step (BI-023EF164). This module turns
// the boundary's closed refusal code into a typed error for the store and a
// structured tool result for the handler.

import type { ToolResult } from "@/lib/mcp-tools";

import { WorkCapsulePublicationRefusedError } from "./work-capsule-terminal-status";

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
}): Promise<void> {
  if (!input.repositoryFullName || !REVIEW_BOUND_STATUSES.has(input.status)) return;
  const { checkWorkroomFailureReadiness } = await import("@/lib/change-review/failure-readiness-publication");
  const readiness = await checkWorkroomFailureReadiness(input.capsuleId);
  if (!readiness.mayPublish) throw new WorkCapsulePublicationRefusedError(readiness);
}

/** The MCP answer for a refusal: the code, the reason, and what to do next. */
export function publicationRefusedToolResult(
  error: Pick<WorkCapsulePublicationRefusedError, "code" | "reason">,
  input: { capsuleId: string; status: string },
): ToolResult {
  return {
    success: false,
    error: error.code,
    message: error.reason,
    data: {
      capsuleId: input.capsuleId,
      requestedStatus: input.status,
      nextAction: error.code === "workroom_identity_incomplete"
        ? "Call adopt_worktree with repositoryFullName, headBranch, worktreePath, baseSha and headSha for this room, then retry update_workroom_status."
        : "Request an independent failure review of the current head (review_semantic_change) and retry once its receipt is recorded.",
    },
  };
}
