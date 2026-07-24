// AI platform posture tool pack — BI-5903D447.
//
// The scheduled task that refreshes AI platform posture knowledge articles
// needs real-time read access to provider status/config, ModelProfile tiers/
// capabilities/toolFidelity, token spend per provider/agent, failover-chain
// integrity, agent-to-provider assignment, and scheduled-task status.
// mcp__dpf__list_all_capability_needs and mcp__dpf__search_tool_marketplace
// only surface partial, derived capability-needs feedback — this tool reads
// the authoritative AI-layer state directly so posture articles are grounded
// in real data, not inference.
//
// Read-only. The handler lazy-imports its single backing aggregation
// (apps/web/lib/ai-platform-posture/get-ai-platform-posture.ts), following
// the established ToolPack pattern (BI-ARCH-TOOLPACKS); grants mirror
// agent-grants.ts TOOL_TO_GRANTS, which stays the gating source.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack, ToolPackHandler } from "../tool-pack";

const definitions: ToolDefinition[] = [
  {
    name: "get_ai_platform_posture",
    description:
      "Read authoritative, real-time AI-layer state in one call: provider status/config, ModelProfile tiers/capabilities/toolFidelity, token spend per provider and per agent (current calendar month), failover-chain integrity (fallback rate + recent fallback chains + provider error codes over a lookback window), agent-to-provider assignment (which provider each agent was most routed to recently), and scheduled-task status (both per-user recurring agent tasks and the platform cron catalog). Read-only — grounds AI-ops posture reporting in real data instead of derived capability-needs feedback.",
    inputSchema: {
      type: "object",
      properties: {
        windowHours: {
          type: "number",
          description: "Lookback window in hours for the failover-chain and agent-assignment signals. Default 24, capped at 168 (7 days).",
        },
        includeRetired: {
          type: "boolean",
          description: "Include retired providers and model profiles. Default false.",
        },
      },
      required: [],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
];

async function getAiPlatformPostureHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const { loadAiPlatformPosture } = await import("@/lib/ai-platform-posture/get-ai-platform-posture");
  const windowHours = typeof params["windowHours"] === "number" ? params["windowHours"] : undefined;
  const includeRetired = typeof params["includeRetired"] === "boolean" ? params["includeRetired"] : undefined;
  const posture = await loadAiPlatformPosture({ windowHours, includeRetired });

  const failing = posture.scheduledTasks.counts.failingAgentTasks + posture.scheduledTasks.counts.failingJobs;
  return {
    success: true,
    message: `${posture.providers.length} provider(s), ${posture.modelProfiles.length} model profile(s), ${(posture.failoverChain.fallbackRate * 100).toFixed(1)}% fallback rate over ${posture.windowHours}h, ${failing} failing scheduled task(s)/job(s).`,
    data: posture as unknown as Record<string, unknown>,
  };
}

const handlers: Record<string, ToolPackHandler> = {
  get_ai_platform_posture: (params) => getAiPlatformPostureHandler(params),
};

export const aiPlatformPosturePack: ToolPack = {
  packId: "ai-platform-posture",
  definitions,
  handlers,
  grants: {
    get_ai_platform_posture: ["agent_control_read"],
  },
};
