import type { ToolExecutionContext, ToolResult } from "@/lib/mcp-tool-types";
import { composeRoomReviewProfile, listRoomReviewDefinitions } from "@/lib/work-management/room-review-profile";
import { clampToolResultForModel, DEFAULT_TOOL_RESULT_CHAR_CAP } from "@/lib/tak/tool-result-budget";

const CURSOR_PREFIX = "workroom-definitions:v1:";
const INSTANCE_FILTERS = ["status", "decisionScope", "portfolioRole", "staleOnly", "headBranch", "pullRequestNumber"];

function refusal(error: string, message: string, disposition: string, args: Record<string, unknown>): ToolResult {
  return { success: false, error, message, data: {
    page: { version: 1, readKind: "workroom-definitions", disposition },
    recovery: { toolName: "list_workrooms", arguments: { view: "definitions", ...args } },
  } };
}

/** Read-only installed metadata. Occurrence/tenant evidence never enters this projection. */
export function listReviewDefinitions(params: Record<string, unknown>, userId: string, context?: ToolExecutionContext): ToolResult {
  if (!userId || !context?.userContext) {
    return { success: false, error: "authority_context_required", message: "An authenticated user context is required." };
  }
  if (INSTANCE_FILTERS.some(key => params[key] !== undefined)) {
    return refusal("invalid_definition_filters", "Definition pages do not accept Workroom instance filters.", "invalid-input", {});
  }
  const limit = params.limit ?? 5;
  if ((params.limit !== undefined && (typeof params.limit !== "number" || !Number.isInteger(params.limit) || params.limit < 1 || params.limit > 100))
    || (params.cursor !== undefined && (typeof params.cursor !== "string" || !params.cursor || params.cursor.length > 1024))) {
    return refusal("invalid_page_input", "Use an integer limit from 1 to 100 and a nonempty definition cursor.", "invalid-input", {});
  }
  const cursor = params.cursor as string | undefined;
  if (cursor !== undefined && !cursor.startsWith(CURSOR_PREFIX)) {
    return refusal("invalid_definition_cursor", "Instance cursors cannot be used for definition pages. Start a new definition traversal.", "restart-required", {});
  }
  // The canonical helper owns alias identity, inventory revision and stale-cursor detection.
  const after = cursor?.slice(CURSOR_PREFIX.length);
  if (after === "") return refusal("invalid_definition_cursor", "Start a new definition traversal.", "restart-required", {});
  try {
    let pageLimit = limit as number;
    for (;;) {
      const inventory = listRoomReviewDefinitions({ limit: pageLimit, after });
      const compositionCounts = { resolved: 0, unsupported: 0, unresolved: 0 };
      const definitions = inventory.items.map(item => {
        const profile = composeRoomReviewProfile(item.sourceKey, []);
        compositionCounts[profile.status]++;
        return { ...item, profile: { status: profile.status, fingerprint: profile.fingerprint } };
      });
      const result: ToolResult = { success: true, message: "", data: {
        view: "definitions", canonicalDefinitionCount: inventory.total,
        occurrenceAssessment: "not-exercised", organizationApplicability: "unknown",
        definitions,
        page: { version: 1, readKind: "workroom-definitions", summaryScope: "page",
          inventoryFingerprint: inventory.inventoryFingerprint,
          compositionCounts, pageCount: definitions.length,
          disposition: inventory.nextCursor ? "more" : "complete",
          nextCursor: inventory.nextCursor ? CURSOR_PREFIX + inventory.nextCursor : null },
      } };
      // Fit whole rows for both native and external callers. Never publish the
      // cursor of a larger, undelivered page, or a truncated successful prefix.
      const encoded = clampToolResultForModel(result, { maxChars: DEFAULT_TOOL_RESULT_CHAR_CAP, toolName: "list_workrooms" });
      if (!encoded.truncated && Buffer.byteLength(JSON.stringify(result), "utf8") <= DEFAULT_TOOL_RESULT_CHAR_CAP) return result;
      if (definitions.length <= 1) {
        return refusal("definition_page_budget_exceeded", "No definition page was delivered. Keep the unchanged cursor; do not advance.",
          "budget-exceeded", { limit: 1, ...(cursor ? { cursor } : {}) });
      }
      pageLimit = Math.max(1, Math.floor(definitions.length / 2));
    }
  } catch (error) {
    if (error instanceof Error && error.message === "Stale or unknown review definition cursor; restart the inventory.") {
      return refusal("definition_restart_required", "The definition inventory changed or the cursor is unknown. Start a new traversal.", "restart-required", {});
    }
    return refusal("definition_inventory_unavailable", "The definition inventory is unavailable; no page or cursor was delivered.", "unavailable", {});
  }
}
