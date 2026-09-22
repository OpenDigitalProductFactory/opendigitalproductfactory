/** Shared by dispatch authorization and the change-review pack metadata. */
export const CHANGE_REVIEW_TOOL_GRANTS: Record<string, string[]> = {
  review_semantic_change: ["backlog_write"],
  record_semantic_review_outcome: ["backlog_write"],
  retry_semantic_review: ["backlog_write"],
};
