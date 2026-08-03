// Optimization tool pack (BI-C350F8B0, EP-8DC217EB BET-0d + BI-A08EBAEC).
//
// Coworker/operator-callable surface of the self-optimization engine: dispatch
// a consolidation bet to Build Studio, attributed to its WSID-profiled
// coworker; and analyze MCP/governed-tool call efficiency (thrash, retries,
// volume) from ToolExecution to cut agent token waste.

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
  {
    name: "analyze_mcp_call_efficiency",
    description:
      "Analyze ToolExecution thrash, retries, high volume, and failures. Recommends skill, tool-merge, or webhook fixes to cut agent token waste. notify=true posts AI Ops alerts.",
    inputSchema: {
      type: "object",
      properties: {
        windowHours: {
          type: "number",
          description: "Lookback window in hours (default 24, max 168).",
        },
        thrashThreshold: {
          type: "number",
          description: "Same-tool calls per thread to flag thrash (default 8).",
        },
        notify: {
          type: "boolean",
          description:
            "When true, create PlatformNotification rows for warning/critical findings (deduped 24h). Default false.",
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

async function analyzeMcpCallEfficiency(
  params: Record<string, unknown>,
): Promise<ToolResult> {
  const { runCallEfficiencyReport } = await import("@/lib/operate/mcp-call-efficiency/report");
  const windowHours =
    typeof params["windowHours"] === "number" ? params["windowHours"] : 24;
  const thrashThreshold =
    typeof params["thrashThreshold"] === "number"
      ? params["thrashThreshold"]
      : undefined;
  const notify = params["notify"] === true;

  const { report, notified } = await runCallEfficiencyReport({
    windowHours,
    thrashThreshold,
    notify,
  });

  const top = report.findings
    .slice(0, 5)
    .map((f) => `${f.severity}:${f.kind}:${f.toolName}→${f.recommendedAction}`)
    .join("; ");

  return {
    success: true,
    message:
      `${report.totalCalls} call(s) in window; ${(report.successRate * 100).toFixed(0)}% success; ` +
      `${report.findings.length} finding(s)` +
      (notified ? `; notified ${notified}` : "") +
      (top ? ` — ${top}` : "") +
      `. ${report.ledgerSufficiency.note}`,
    data: {
      ...report,
      notified,
    } as unknown as Record<string, unknown>,
  };
}

export const optimizationPack: ToolPack = {
  packId: "optimization",
  definitions,
  handlers: {
    dispatch_consolidation_bet: (params, userId) => dispatchBet(params, userId),
    analyze_mcp_call_efficiency: (params) => analyzeMcpCallEfficiency(params),
  },
  grants: {
    dispatch_consolidation_bet: ["build_promote"],
    analyze_mcp_call_efficiency: ["agent_control_read"],
  },
};
