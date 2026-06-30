import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack } from "../tool-pack";

const definitions: ToolDefinition[] = [
  {
    name: "request_self_upgrade",
    description:
      "Request the governed portal self-upgrade pipeline. Queues the same run path as the operator control when the install is inside its allowed off-hours window; outside that window it returns a human-override-required result and does not queue a run.",
    inputSchema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Optional short audit tag for the request origin.",
        },
      },
      required: [],
    },
    requiredCapability: "manage_provider_connections",
    executionMode: "immediate",
    sideEffect: true,
  },
];

function auditTag(params: Record<string, unknown>, context?: { agentId?: string }): string {
  const reason = typeof params["reason"] === "string" ? params["reason"].trim() : "";
  if (reason) return reason.slice(0, 80);
  return context?.agentId?.trim() || "agent";
}

async function requestSelfUpgradeTool(
  params: Record<string, unknown>,
  _userId: string,
  context?: { agentId?: string },
): Promise<ToolResult> {
  const { requestSelfUpgrade } = await import("@/lib/self-upgrade/request");
  const result = await requestSelfUpgrade({
    requestedBy: `mcp:${auditTag(params, context)}`,
    actorKind: "agent",
  });

  if (result.status === "queued") {
    return {
      success: true,
      message: `Queued governed self-upgrade ${result.runId}.`,
      data: result as unknown as Record<string, unknown>,
    };
  }

  if (result.status === "already_active") {
    return {
      success: true,
      message: `Self-upgrade ${result.runId} is already active.`,
      data: result as unknown as Record<string, unknown>,
    };
  }

  if (result.status === "human_override_required") {
    return {
      success: true,
      message: result.message,
      data: result as unknown as Record<string, unknown>,
    };
  }

  return {
    success: false,
    error: result.message,
    message: result.message,
    data: result as unknown as Record<string, unknown>,
  };
}

export const selfUpgradePack: ToolPack = {
  packId: "self-upgrade",
  definitions,
  handlers: {
    request_self_upgrade: requestSelfUpgradeTool,
  },
  grants: {
    request_self_upgrade: ["admin_write"],
  },
};
