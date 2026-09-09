import { prisma } from "@dpf/db";
import type { ToolResult } from "@/lib/mcp-tools";
import { declareBreakFix, type DeclareBreakFixDb } from "./declare-break-fix";
import { workCapsuleActor } from "./handler-actor";

type ToolContext = {
  routeContext?: string;
  agentId?: string;
  threadId?: string;
  taskRunId?: string;
} | undefined;

function stringParam(params: Record<string, unknown>, key: string): string | null {
  const value = params[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * MCP handler for `declare_break_fix` (design 2026-09-02 §4, §5 rulings 1–2).
 * Kept out of mcp-handlers.ts so that module stays under the size ceiling.
 */
export async function declareBreakFixTool(
  params: Record<string, unknown>,
  userId: string,
  context: ToolContext,
): Promise<ToolResult> {
  const itemId = stringParam(params, "itemId");
  const reason = stringParam(params, "reason");
  if (!itemId || !reason) return { success: false, error: "invalid_input", message: "itemId and reason are required." };
  const result = await declareBreakFix({
    db: prisma as unknown as DeclareBreakFixDb,
    itemId,
    reason,
    actor: await workCapsuleActor(userId, context),
  });
  if (!result.ok) return { success: false, error: result.error, message: result.message, data: result.data };
  return {
    success: true,
    entityId: result.capsuleId,
    message: `Break-fix declared for ${result.itemId} on ${result.capsuleId}. Post-implementation review is due by ${result.pirDueAt}; someone other than you records it with record_initiative_post_implementation_review.`,
    data: result,
  };
}
