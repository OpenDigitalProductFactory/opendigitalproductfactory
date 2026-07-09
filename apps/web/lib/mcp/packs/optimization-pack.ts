// Optimization tool pack (BI-C350F8B0, EP-8DC217EB BET-0d).
//
// Coworker/operator-callable surface of the self-optimization engine: dispatch
// a consolidation bet to Build Studio, attributed to its WSID-profiled
// coworker. Pack-registered (not the frozen mcp-tools.ts inline switch); the
// handler defers to the dispatch harness lib, which reuses the same governed
// promotion core as promote_to_build_studio (WIP cap, governed auto-approve,
// Ideate auto-dispatch).

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack } from "../tool-pack";

const definitions: ToolDefinition[] = [
  {
    name: "dispatch_consolidation_bet",
    description:
      "Dispatch a platform consolidation bet into Build Studio: promotes the bet's open, build-triaged backlog items to governed build drafts and attributes the work to the profession-matched coworker. Returns what was promoted and what was skipped with reasons (untriaged, already building, WIP cap). Use when a consolidation bet is ready to move from registry to active delivery.",
    inputSchema: {
      type: "object",
      properties: {
        betKey: {
          type: "string",
          description: "The consolidation bet key, e.g. 'BET-11'.",
        },
      },
      required: ["betKey"],
    },
    requiredCapability: "manage_backlog",
    executionMode: "immediate",
    sideEffect: true,
  },
];

async function dispatchBet(
  params: Record<string, unknown>,
  userId: string,
): Promise<ToolResult> {
  const { dispatchConsolidationBet } = await import("@/lib/optimization/dispatch-bet");

  const betKey = String(params["betKey"] ?? "").trim().toUpperCase();
  if (!/^BET-\d+$/.test(betKey)) {
    return {
      success: false,
      error: "invalid_params",
      message: "Provide a betKey like 'BET-11'.",
    };
  }

  const result = await dispatchConsolidationBet({ betKey, userId });
  if ("error" in result) {
    return { success: false, error: result.error, message: result.message };
  }

  const promotedList = result.promoted.map((entry) => `${entry.itemId}→${entry.buildId}`).join(", ");
  const skippedList = result.skipped.map((entry) => `${entry.itemId} (${entry.reason})`).join(", ");
  return {
    success: true,
    entityId: result.betKey,
    message:
      `${result.betKey}: promoted ${result.promoted.length} item(s)` +
      (promotedList ? ` [${promotedList}]` : "") +
      (result.skipped.length > 0 ? `; skipped ${result.skipped.length} [${skippedList}]` : "") +
      (result.coworker ? `; craft owner ${result.coworker.name} (${result.professionKey})` : ""),
    data: result,
  };
}

export const optimizationPack: ToolPack = {
  packId: "optimization",
  definitions,
  handlers: {
    dispatch_consolidation_bet: (params, userId) => dispatchBet(params, userId),
  },
  grants: {
    dispatch_consolidation_bet: ["build_promote"],
  },
};
