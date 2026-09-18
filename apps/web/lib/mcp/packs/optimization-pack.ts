// Optimization tool pack (BI-C350F8B0, EP-8DC217EB BET-0d + BI-A08EBAEC + BI-3003EE63).
//
// Coworker/operator-callable surface of the self-optimization engine: dispatch
// a consolidation bet to Build Studio, attributed to its WSID-profiled
// coworker; analyze MCP/governed-tool call efficiency (thrash, retries,
// volume) from ToolExecution; and analyze A2A coworker↔coworker edge health.

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
      "Analyze MCP call efficiency over an explicit complete or partial time window. Returns requested/observed bounds, snapshot population, included calls and scan budgets. Complete reports recommend skill, tool-merge or webhook fixes. Partial reports are diagnostics only: narrow the window and restart; no corrective BIs or AI Ops dispatch. notify=true posts deduplicated findings or a coverage warning; dispatchAiOps=true acts only on a complete scan.",
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
        dispatchAiOps: {
          type: "boolean",
          description:
            "When true, file critical findings as backlog items, record ImprovementSignals, and queue a one-shot AI Ops (platform-engineer) review task. Default false (daily cron enables this).",
        },
      },
      required: [],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    // notify/dispatchAiOps write platform rows; default path is read-only analysis.
    sideEffect: true,
    annotations: { readOnlyHint: false, idempotentHint: true },
  },
  {
    name: "analyze_a2a_collaboration_health",
    description:
      "Analyze coworker↔coworker (A2A) edges for failed/blocked handoffs, stuck active delegations, orphan task lineage, and pair failure rates. notify=true posts AI Ops alerts; dispatchAiOps=true files critical BIs and queues a one-shot platform-engineer review. Twin of analyze_mcp_call_efficiency for the multi-agent plane.",
    inputSchema: {
      type: "object",
      properties: {
        windowHours: {
          type: "number",
          description: "Lookback window in hours (default 24, max 168).",
        },
        notify: {
          type: "boolean",
          description:
            "When true, create PlatformNotification rows for warning/critical findings (deduped 24h). Default false.",
        },
        dispatchAiOps: {
          type: "boolean",
          description:
            "When true, file critical findings as backlog items, record ImprovementSignals, and queue a one-shot AI Ops (platform-engineer) review task. Default false (daily cron enables this).",
        },
      },
      required: [],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
    annotations: { readOnlyHint: false, idempotentHint: true },
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
  userId: string,
): Promise<ToolResult> {
  const { runCallEfficiencyReport } = await import("@/lib/operate/mcp-call-efficiency/report");
  const windowHours =
    typeof params["windowHours"] === "number" ? params["windowHours"] : 24;
  const thrashThreshold =
    typeof params["thrashThreshold"] === "number"
      ? params["thrashThreshold"]
      : undefined;
  const notify = params["notify"] === true;
  const dispatchAiOps = params["dispatchAiOps"] === true;

  const { report, notified, aiOps } = await runCallEfficiencyReport({
    windowHours,
    thrashThreshold,
    notify,
    dispatchAiOps,
    ownerUserId: dispatchAiOps ? userId : undefined,
  });

  const top = report.findings
    .slice(0, 5)
    .map((f) => `${f.severity}:${f.kind}:${f.toolName}→${f.recommendedAction}`)
    .join("; ");

  const aiOpsNote =
    aiOps == null
      ? ""
      : aiOps.skipped
        ? `; aiOps skipped (${aiOps.reason})`
        : `; aiOps task=${aiOps.agentTaskId} bis=${aiOps.backlogItemsFiled.length}`;

  return {
    success: true,
    message:
      `${report.coverage.complete ? "Complete" : "Partial"} window: ${report.totalCalls}/${report.coverage.populationCount} included call(s); ` +
      `${(report.successRate * 100).toFixed(0)}% success across all included calls (governed refusals remain in this denominator); ` +
      `${report.findings.length} finding(s)` +
      (notified ? `; notified ${notified}` : "") +
      aiOpsNote +
      (top ? ` — ${top}` : "") +
      `. ${report.ledgerSufficiency.note}`,
    data: {
      ...report,
      notified,
      aiOps,
    } as unknown as Record<string, unknown>,
  };
}

async function analyzeA2aCollaborationHealth(
  params: Record<string, unknown>,
  userId: string,
): Promise<ToolResult> {
  const { runCollaborationHealthReport } = await import(
    "@/lib/operate/a2a-collaboration-health/report"
  );
  const windowHours =
    typeof params["windowHours"] === "number" ? params["windowHours"] : 24;
  const notify = params["notify"] === true;
  const dispatchAiOps = params["dispatchAiOps"] === true;

  const { report, notified, aiOps } = await runCollaborationHealthReport({
    windowHours,
    notify,
    dispatchAiOps,
    ownerUserId: dispatchAiOps ? userId : undefined,
  });

  const top = report.findings
    .slice(0, 5)
    .map((f) => `${f.severity}:${f.kind}:${f.edgeKind}→${f.recommendedAction}`)
    .join("; ");

  const aiOpsNote =
    aiOps == null
      ? ""
      : aiOps.skipped
        ? `; aiOps skipped (${aiOps.reason})`
        : `; aiOps task=${aiOps.agentTaskId} bis=${aiOps.backlogItemsFiled.length}`;

  return {
    success: true,
    message:
      `${report.totalEdges} edge(s) in window; ${(report.successRate * 100).toFixed(0)}% completed; ` +
      `${report.findings.length} finding(s)` +
      (notified ? `; notified ${notified}` : "") +
      aiOpsNote +
      (top ? ` — ${top}` : "") +
      `. ${report.ledgerSufficiency.note}`,
    data: {
      ...report,
      notified,
      aiOps,
    } as unknown as Record<string, unknown>,
  };
}

export const optimizationPack: ToolPack = {
  packId: "optimization",
  definitions,
  handlers: {
    dispatch_consolidation_bet: (params, userId) => dispatchBet(params, userId),
    analyze_mcp_call_efficiency: (params, userId) =>
      analyzeMcpCallEfficiency(params, userId),
    analyze_a2a_collaboration_health: (params, userId) =>
      analyzeA2aCollaborationHealth(params, userId),
  },
  grants: {
    dispatch_consolidation_bet: ["build_promote"],
    analyze_mcp_call_efficiency: ["agent_control_read"],
    analyze_a2a_collaboration_health: ["agent_control_read"],
  },
};
