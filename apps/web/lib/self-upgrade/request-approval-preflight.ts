import type { GovernedExecuteArgs } from "@/lib/mcp-governed-execute-types";
import type { ToolResult } from "@/lib/mcp-tool-types";
import { can } from "@/lib/permissions";
import { getAgentToolGrantsAsync, isToolAllowedByGrants } from "@/lib/tak/agent-grants";
import { readSelfUpgradeAdmission } from "./request";
import type { CoworkerApprovalBinding } from "@/lib/govern/authority/coworker-authority-decision";
import { hasCurrentAuthorityApproval } from "@/lib/coworker/authority-approval-envelope";

/** A terminal observation, never permission to invoke the upgrade handler. */
export async function preflightUnadmittedUpgrade(
  execution: GovernedExecuteArgs,
  binding: CoworkerApprovalBinding,
): Promise<ToolResult | null> {
  if (execution.toolName !== "request_self_upgrade"
    || Object.keys(execution.rawParams).some(key => key !== "reason")
    || (execution.rawParams.reason !== undefined && typeof execution.rawParams.reason !== "string")
    || !execution.context?.agentId
    || !can(execution.userContext, "view_operations")) return null;

  const readTool = "get_self_upgrade_queue_status";
  try {
    // Persisted current grants are deliberately required; a broad task/room
    // grant cannot manufacture permission to inspect this additional surface.
    if (!isToolAllowedByGrants(readTool, await getAgentToolGrantsAsync(execution.context.agentId))) return null;
    if (execution.context.apiTokenId
      && !isToolAllowedByGrants(readTool, execution.context.tokenGrantScopes ?? [])) return null;
    if (await hasCurrentAuthorityApproval(binding)) return null;

    const check = await readSelfUpgradeAdmission({ actorKind: "agent", requestedBy: "mcp:admission-observation" });
    if (check.kind !== "terminal" || check.result.status !== "batch_below_threshold") return null;
    return { success: true, message: check.result.message, data: { ...check.result } };
  } catch {
    // Missing observation is not proof that an update is harmless. Preserve
    // the original approval and action-time admission path on uncertainty.
    return null;
  }
}
