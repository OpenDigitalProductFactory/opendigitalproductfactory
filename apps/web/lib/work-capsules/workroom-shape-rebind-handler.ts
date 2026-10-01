// MCP entry point for the governed work-shape rebind (BI-CB5C0DCE, phase 3).
// Same server function and authority as the room page. A rebind is a person's
// decision, so a task run (an autonomous or delegated coworker) may preview it
// but never apply it.

import { prisma } from "@dpf/db";
import type { ToolExecutionContext, ToolResult } from "@/lib/mcp-tool-types";
import { currentUserContext } from "@/lib/govern/current-user-context";
import { can } from "@/lib/permissions";
import { rebindWorkroomShapeForUser } from "@/lib/work-management/workroom-shape-rebind.server";

function text(params: Record<string, unknown>, key: string): string | null {
  const value = params[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function rebindWorkroomShapeTool(
  params: Record<string, unknown>,
  userId: string,
  context?: ToolExecutionContext,
): Promise<ToolResult> {
  const capsuleId = text(params, "capsuleId");
  const toVersion = text(params, "toVersion");
  if (!capsuleId || !toVersion) {
    return { success: false, error: "invalid_input", message: "capsuleId (WC-*) and toVersion are required." };
  }
  const dryRun = params.dryRun !== false;
  if (!dryRun && context?.taskRunId) {
    return {
      success: false,
      error: "not_authorized",
      message: "A rebind is a decision for a person. Preview it with dryRun, and leave the decision to the room's owner.",
    };
  }
  const human = await currentUserContext(userId);
  const result = await rebindWorkroomShapeForUser(prisma as never, {
    capsuleId,
    toKey: text(params, "toKey"),
    toVersion,
    rationale: text(params, "rationale"),
    dryRun,
    userId,
    agentId: context?.agentId ?? null,
    callerHasManagePlatform: Boolean(human && can(human, "manage_platform")),
  });
  if (!result.ok) return { success: false, error: result.code, message: result.error };
  return {
    success: true,
    message: result.applied
      ? `Rebound ${result.capsuleId} from ${result.fromRef} to ${result.toRef}.`
      : `Preview: ${result.fromRef} -> ${result.toRef} is a ${result.diff.classification}. Nothing was written.`,
    data: { applied: result.applied, from: result.fromRef, to: result.toRef, diff: result.diff },
  };
}
