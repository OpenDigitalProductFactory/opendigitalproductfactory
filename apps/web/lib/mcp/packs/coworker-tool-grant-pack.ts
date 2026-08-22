// Coworker tool-grant provisioning pack.
//
// Owns manage_coworker_tool_grant — the coworker-callable door that lets an
// authorized AI Operations coworker grant or revoke a single tool-authority
// grant key on another coworker (fulfil a capability need / trim an over-broad
// tool surface). The write path already exists as the grantCoworkerTool /
// revokeCoworkerTool server actions; this exposes it on the MCP surface behind
// defence in depth. Lives in a scoped pack so mcp-tools.ts stays a thin
// composition layer instead of growing the frozen inline switch.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack } from "../tool-pack";

const definitions: ToolDefinition[] = [
  {
    name: "manage_coworker_tool_grant",
    description:
      "Grant or revoke a single tool-authority grant key on another coworker. Use to provision a capability a coworker is missing (grant) or to trim an over-broad tool surface (revoke). The grant key must be one the platform recognises; a coworker cannot change its own authority.",
    inputSchema: {
      type: "object",
      properties: {
        coworker: {
          type: "string",
          description: "The coworker to modify — its agentId, slug, or display name (e.g. 'external-catalog-scout').",
        },
        grantKey: {
          type: "string",
          description: "The tool-authority grant key to grant or revoke (e.g. 'backlog_write', 'registry_read').",
        },
        action: { type: "string", enum: ["grant", "revoke"], description: "Whether to grant or revoke the key." },
      },
      required: ["coworker", "grantKey", "action"],
    },
    requiredCapability: "manage_platform",
    sideEffect: true,
    // changes identity or authority → consult-gated (TAK §8.4.1).
    consequence: "authority",
  },
];

async function manageCoworkerToolGrantHandler(
  params: Record<string, unknown>,
  userId: string,
  context?: { agentId?: string },
): Promise<ToolResult> {
  const { manageCoworkerToolGrant } = await import("@/lib/tak/coworker-tool-grant-core");
  const result = await manageCoworkerToolGrant({
    coworkerRef: String(params["coworker"] ?? ""),
    grantKey: String(params["grantKey"] ?? ""),
    action: String(params["action"] ?? "").trim() as "grant" | "revoke",
    callerAgentId: context?.agentId ?? null,
    grantedBy: userId,
  });
  if (!result.ok) {
    return { success: false, error: result.code, message: result.message };
  }
  const verb = result.action === "grant" ? "Granted" : "Revoked";
  const prep = result.action === "grant" ? "to" : "from";
  return {
    success: true,
    entityId: result.coworker.agentId,
    message: `${verb} "${result.grantKey}" ${prep} ${result.coworker.displayName} (${result.coworker.agentId}).`,
    data: { coworker: result.coworker.agentId, grantKey: result.grantKey, action: result.action },
  };
}

export const coworkerToolGrantPack: ToolPack = {
  packId: "coworker-tool-grant",
  definitions,
  handlers: {
    manage_coworker_tool_grant: (params, userId, context) =>
      manageCoworkerToolGrantHandler(params, userId, context),
  },
  grants: {
    manage_coworker_tool_grant: ["agent_control_read"],
  },
};
