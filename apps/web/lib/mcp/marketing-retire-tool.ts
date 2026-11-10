// retire_marketing_work — archive stale briefs and asset tasks (BI-FB24DC2C).
//
// Split from marketing-ops-pack.ts, like record_marketing_grounding, so the pack
// stays inside its size ceiling. The write itself lives in
// lib/marketing/retire-work.ts.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tool-types";

export const retireMarketingWorkDefinition: ToolDefinition = {
  name: "retire_marketing_work",
  description:
    "Archive campaign briefs and asset tasks that rest on a wrong or outdated premise (wrong audience, superseded campaign, duplicate), with the reason. Archived work leaves the active strategy, scheduler and calendar but is kept for history — nothing is deleted. Use the ids from get_marketing_summary.",
  inputSchema: {
    type: "object",
    properties: {
      briefIds: { type: "array", items: { type: "string" }, description: "Campaign brief ids to archive" },
      taskIds: { type: "array", items: { type: "string" }, description: "Asset task ids to archive" },
      reason: { type: "string", description: "Why this work is retired, in one sentence the owner can read later" },
    },
    required: ["reason"],
  },
  requiredCapability: "operate_marketing",
  sideEffect: true,
  coworkerArtifact: true,
};

const asIds = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && id.trim() !== "") : [];

export async function retireMarketingWorkHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const reason = typeof params["reason"] === "string" ? params["reason"].trim() : "";
  const briefIds = asIds(params["briefIds"]);
  const taskIds = asIds(params["taskIds"]);
  if (!reason) {
    return { success: false, error: "reason_required", message: "Say why the work is retired; the owner reads it later." };
  }
  if (briefIds.length === 0 && taskIds.length === 0) {
    return { success: false, error: "nothing_named", message: "Name at least one brief or asset task id to retire." };
  }

  const { resolveMarketingOrganizationId } = await import("@/lib/marketing/org-scope");
  const organizationId = await resolveMarketingOrganizationId();
  if (!organizationId) {
    return { success: false, error: "no_organization", message: "No organization workspace is configured." };
  }

  const { retireMarketingWork } = await import("@/lib/marketing/retire-work");
  const result = await retireMarketingWork({ organizationId, briefIds, taskIds, reason });
  return { success: true, message: result.message, data: result };
}
