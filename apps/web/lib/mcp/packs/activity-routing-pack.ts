// Activity-routing tool pack.
//
// Keeps activity-harness governance acknowledgements out of the frozen
// mcp-tools.ts inline dispatcher while preserving the same proposal approval
// payload shape used by the supervisor rail.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack } from "../tool-pack";

const definitions: ToolDefinition[] = [
  {
    name: "activity_harness_confidence_override",
    description:
      "Acknowledge an approved activity-routing harness confidence override so future task/activity routing can use the tuned confidence level.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["activity-harness-confidence-override"] },
        proposalId: { type: "string" },
        activityClass: { type: "string" },
        harnessRecipeKey: { type: "string" },
        providerId: { type: "string" },
        modelId: { type: ["string", "null"] },
        confidence: { type: "string", enum: ["provisional", "calibrating", "trusted", "degraded"] },
      },
      required: ["kind", "activityClass", "harnessRecipeKey", "providerId", "confidence"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
    // changes identity or authority → consult-gated (TAK §8.4.1).
    consequence: "authority",
  },
];

async function acknowledgeActivityHarnessConfidenceOverride(
  params: Record<string, unknown>,
): Promise<ToolResult> {
  return {
    success: true,
    message: "Activity routing confidence override approved.",
    data: {
      kind: "activity-harness-confidence-override",
      activityClass: typeof params["activityClass"] === "string" ? params["activityClass"] : null,
      harnessRecipeKey: typeof params["harnessRecipeKey"] === "string" ? params["harnessRecipeKey"] : null,
      providerId: typeof params["providerId"] === "string" ? params["providerId"] : null,
      modelId: typeof params["modelId"] === "string" ? params["modelId"] : null,
      confidence: typeof params["confidence"] === "string" ? params["confidence"] : null,
    },
  };
}

export const activityRoutingPack: ToolPack = {
  packId: "activity-routing",
  definitions,
  handlers: {
    activity_harness_confidence_override: (params) =>
      acknowledgeActivityHarnessConfidenceOverride(params),
  },
  grants: {
    activity_harness_confidence_override: ["agent_control_read"],
  },
};
