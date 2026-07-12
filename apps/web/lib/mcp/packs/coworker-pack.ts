// Coworker collaboration tool pack — BI-ARCH-TOOLPACKS.
//
// Drains the two multi-agent collaboration doors out of the mcp-tools.ts
// executeTool switch: request_coworker (hand off a scoped sub-task to a named
// peer) and summon_coworker (bring a named peer into the current conversation).
// Both validate the caller thread context and delegate to the shared
// coworker-collaboration module, so behaviour is identical when a tool is
// invoked over MCP.
//
// Definitions moved verbatim out of the inline PLATFORM_TOOLS array. These tools
// carry no TOOL_TO_GRANTS entry (advise-safe coordination gated elsewhere), so
// grants is empty and there is nothing to drift against.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack, ToolPackHandler } from "../tool-pack";

const definitions: ToolDefinition[] = [
  {
    name: "request_coworker",
    description:
      "Hand off a scoped sub-task to a NAMED peer coworker. Unlike spawn_work_thread (anonymous child), this targets a specific coworker by agentId or slug and emits a VISIBLE handoff the user sees inline. Use when you need another coworker's distinct capability (e.g. ask the Enterprise Architect to review a schema).",
    inputSchema: {
      type: "object",
      properties: {
        targetAgent: { type: "string", description: "Target coworker — canonical agentId (AGT-*) or slug alias (e.g. 'ea-architect')." },
        objective: { type: "string", description: "The scoped sub-task for the peer coworker." },
        questionPacketSummary: { type: "string", description: "Optional one-line summary of the intent/question shown on the handoff card." },
        tier: { type: "number", enum: [2, 3], description: "Interaction tier (default 2). Tier 3 requires depth-2 spawn support." },
        enteredVia: { type: "string", enum: ["handoff", "escalation", "spawn"], description: "How the peer is entering (default 'handoff')." },
      },
      required: ["targetAgent", "objective"],
    },
    requiredCapability: null,
    sideEffect: true,
    // Delegation is advise-safe coordination — an advisor may route a scoped
    // sub-task to a named peer with a visible handoff without leaving advise
    // mode. Kept sideEffect:true for annotations; adviseCoordination exempts it
    // from the advise-mode runtime filter (BI-7EB4AE2C).
    adviseCoordination: true,
  },
  {
    name: "summon_coworker",
    description:
      "Bring a NAMED coworker into the current conversation as a second/third-tier participant to address part of the work, emitting a VISIBLE summon the user sees inline. YOU (the active coworker) decide which peer to bring in and what to task them with — this is your responsibility, not the user's. Use when a request needs a peer's distinct capability alongside you in the conversation.",
    inputSchema: {
      type: "object",
      properties: {
        targetAgent: { type: "string", description: "Target coworker — canonical agentId (AGT-*) or slug alias." },
        objective: { type: "string", description: "What the summoned coworker should address." },
        tier: { type: "number", enum: [2, 3], description: "Interaction tier (default 2)." },
      },
      required: ["targetAgent", "objective"],
    },
    requiredCapability: null,
    sideEffect: true,
    // Bringing a named peer into the conversation is advise-safe coordination —
    // the advisor decides which teammate to pull in; the handoff is visible and
    // reversible. Kept sideEffect:true for annotations; adviseCoordination
    // exempts it from the advise-mode runtime filter (BI-7EB4AE2C).
    adviseCoordination: true,
  },
];

async function requestCoworkerHandler(
  params: Record<string, unknown>,
  userId: string,
  context?: Parameters<ToolPackHandler>[2],
): Promise<ToolResult> {
  if (!context?.threadId) {
    return { success: false, error: "missing_threadId", message: "request_coworker requires caller thread context." };
  }
  const targetAgent = String(params["targetAgent"] ?? "").trim();
  const objective = String(params["objective"] ?? "").trim();
  if (!targetAgent || !objective) {
    return { success: false, error: "invalid_params", message: "request_coworker requires targetAgent and objective." };
  }
  const tierParam = Number(params["tier"]);
  const enteredViaParam = typeof params["enteredVia"] === "string" ? params["enteredVia"] : undefined;
  const { requestCoworker } = await import("@/lib/tak/coworker-collaboration");
  try {
    const result = await requestCoworker(
      {
        parentThreadId: context.threadId,
        targetAgent,
        objective,
        tier: tierParam === 3 ? 3 : 2,
        enteredVia: enteredViaParam === "escalation" || enteredViaParam === "spawn" ? enteredViaParam : "handoff",
        callerAgentId: context.agentId ?? null,
        questionPacketSummary: typeof params["questionPacketSummary"] === "string" ? params["questionPacketSummary"] : undefined,
        routeContext: context.routeContext,
      },
      userId,
    );
    return {
      success: true,
      entityId: result.childThreadId,
      message: `Handed off to ${result.targetLabel}.`,
      data: result,
    };
  } catch (err) {
    return { success: false, error: "handoff_failed", message: err instanceof Error ? err.message : "request_coworker failed." };
  }
}

async function summonCoworkerHandler(
  params: Record<string, unknown>,
  userId: string,
  context?: Parameters<ToolPackHandler>[2],
): Promise<ToolResult> {
  if (!context?.threadId) {
    return { success: false, error: "missing_threadId", message: "summon_coworker requires caller thread context." };
  }
  const targetAgent = String(params["targetAgent"] ?? "").trim();
  const objective = String(params["objective"] ?? "").trim();
  if (!targetAgent || !objective) {
    return { success: false, error: "invalid_params", message: "summon_coworker requires targetAgent and objective." };
  }
  const tierParam = Number(params["tier"]);
  const { summonCoworker } = await import("@/lib/tak/coworker-collaboration");
  try {
    const result = await summonCoworker(
      {
        parentThreadId: context.threadId,
        targetAgent,
        objective,
        tier: tierParam === 3 ? 3 : 2,
        callerAgentId: context.agentId ?? null,
        routeContext: context.routeContext,
      },
      userId,
    );
    return {
      success: true,
      entityId: result.childThreadId,
      message: `Summoned ${result.targetLabel}.`,
      data: result,
    };
  } catch (err) {
    return { success: false, error: "summon_failed", message: err instanceof Error ? err.message : "summon_coworker failed." };
  }
}

const handlers: Record<string, ToolPackHandler> = {
  request_coworker: (params, userId, context) => requestCoworkerHandler(params, userId, context),
  summon_coworker: (params, userId, context) => summonCoworkerHandler(params, userId, context),
};

export const coworkerPack: ToolPack = {
  packId: "coworker",
  definitions,
  handlers,
  grants: {},
};
