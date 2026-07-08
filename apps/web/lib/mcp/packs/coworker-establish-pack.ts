// Coworker factory-door pack (EP-COWORKER-LIFECYCLE Phase 3, BI-2C4056BF).
//
// Owns establish_coworker — the single MCP door for creating a coworker from
// any dev surface. "establish" creates the DB-side draft (Agent row in
// lifecycleStage "draft" + grants + model floor + principal) and returns the
// code-side definition checklist the Phase 1 conformance gate enforces;
// "promote" flips draft → production only when the definition has landed in
// the canonical roster AND the coworker holds a passing Phase 2 behavioral
// certification. Draft coworkers are blocked by the lifecycle gate until then.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack } from "../tool-pack";

const definitions: ToolDefinition[] = [
  {
    name: "establish_coworker",
    description:
      "Create a new AI coworker as a draft (action 'establish'), or promote a draft to production once its definition has landed and it passed behavioral certification (action 'promote'). Establishing returns the definition checklist that must be completed via PR; a draft coworker is not summonable until promoted.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["establish", "promote"],
          description: "'establish' creates a draft coworker; 'promote' activates a defined+certified draft.",
        },
        agentId: {
          type: "string",
          description: "Kebab-case coworker id, e.g. 'field-safety-auditor'.",
        },
        name: { type: "string", description: "Display name (establish only), e.g. 'Field Safety Auditor'." },
        description: { type: "string", description: "One-sentence role description (establish only)." },
        valueStream: {
          type: "string",
          description: "Optional value stream (establish only), e.g. 'operate', 'consume', 'cross-cutting'.",
        },
        sensitivity: {
          type: "string",
          enum: ["internal", "confidential", "restricted"],
          description: "Data sensitivity (establish only). Defaults to internal.",
        },
        grants: {
          type: "array",
          items: { type: "string" },
          description: "Tool-authority grant keys from the closed vocabulary (establish only). Unknown keys are rejected.",
        },
        minimumTier: {
          type: "string",
          enum: ["frontier", "strong", "adequate", "basic"],
          description: "Minimum model tier floor (establish only). Defaults to adequate.",
        },
      },
      required: ["action", "agentId"],
    },
    requiredCapability: "manage_platform",
    sideEffect: true,
  },
];

async function establishCoworkerHandler(
  params: Record<string, unknown>,
  userId: string,
): Promise<ToolResult> {
  const action = String(params["action"] ?? "").trim();
  const agentId = String(params["agentId"] ?? "").trim();

  if (action === "promote") {
    const { promoteCoworker } = await import("@/lib/coworker-lifecycle/establish-coworker");
    const result = await promoteCoworker(agentId);
    if (!result.ok) return { success: false, error: result.code, message: result.message };
    return {
      success: true,
      entityId: result.agentId,
      message: `Promoted ${result.agentId} to production — it is now summonable.`,
      data: { agentId: result.agentId, stage: result.stage },
    };
  }

  if (action !== "establish") {
    return { success: false, error: "invalid_action", message: "action must be 'establish' or 'promote'." };
  }

  const { establishCoworker } = await import("@/lib/coworker-lifecycle/establish-coworker");
  const result = await establishCoworker(
    {
      agentId,
      name: String(params["name"] ?? ""),
      description: String(params["description"] ?? ""),
      valueStream: params["valueStream"] ? String(params["valueStream"]) : undefined,
      sensitivity: params["sensitivity"] as "internal" | "confidential" | "restricted" | undefined,
      grants: Array.isArray(params["grants"]) ? params["grants"].map(String) : undefined,
      minimumTier: params["minimumTier"] ? String(params["minimumTier"]) : undefined,
    },
    userId,
  );
  if (!result.ok) return { success: false, error: result.code, message: result.message };
  return {
    success: true,
    entityId: result.agentId,
    message: `Established draft coworker ${result.agentId}. It is NOT summonable until its definition lands and it is promoted. Checklist:\n${result.checklist
      .map((step, i) => `${i + 1}. ${step}`)
      .join("\n")}`,
    data: { agentId: result.agentId, stage: result.stage, checklist: result.checklist },
  };
}

export const coworkerEstablishPack: ToolPack = {
  packId: "coworker-establish",
  definitions,
  handlers: {
    establish_coworker: (params, userId) => establishCoworkerHandler(params, userId),
  },
  grants: {
    establish_coworker: ["agent_control_read"],
  },
};
