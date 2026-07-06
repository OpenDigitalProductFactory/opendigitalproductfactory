import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack } from "../tool-pack";

const definitions: ToolDefinition[] = [
  {
    name: "request_self_upgrade",
    description:
      "Request the governed portal self-upgrade pipeline. Queues the same run path as the operator control when the install is inside its allowed off-hours window; outside that window it returns a human-override-required result and does not queue a run. Routine requests also wait for the release batch: when fewer merged updates have accumulated than the batch threshold, it returns a batch-below-threshold result with the pending tally instead of queueing — wait for the batch to deploy before validating live.",
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
  {
    name: "get_self_upgrade_queue_status",
    description:
      "Read the release-batch queue state for the governed self-upgrade: how many merged updates (PRs) are pending since the deployed lineage, the batch threshold and max-wait valve, and whether a routine upgrade is currently eligible. Use it to decide whether an upgrade is imminent or more updates are still to be tallied — if not imminent, keep working and validate live after the batch deploys. Read-only.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    requiredCapability: "view_operations",
    executionMode: "immediate",
    sideEffect: false,
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

  if (result.status === "batch_below_threshold") {
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

async function getSelfUpgradeQueueStatusTool(): Promise<ToolResult> {
  const [{ resolveReleaseBatchStatus }, { getSelfUpgradeConfig }, { getLatestRun }] =
    await Promise.all([
      import("@/lib/self-upgrade/release-batch-status"),
      import("@/lib/self-upgrade/config"),
      import("@/lib/self-upgrade/run-store"),
    ]);
  const config = await getSelfUpgradeConfig();
  const [batch, latestRun] = await Promise.all([
    resolveReleaseBatchStatus({ fresh: true, config }),
    getLatestRun(),
  ]);
  return {
    success: true,
    message: batch.summary,
    data: {
      enabled: config.enabled,
      sourceMode: config.sourceMode,
      batchingApplicable: batch.applicable,
      routineUpgradeEligible: batch.eligible,
      reason: batch.reason,
      pendingPrCount: batch.pendingCount,
      batchMinPendingPrs: batch.minPendingPrs,
      batchMaxWaitHours: batch.maxWaitHours,
      oldestPendingAt: batch.oldestPendingAt?.toISOString() ?? null,
      lineageSha: batch.lineageSha,
      latestRun: latestRun
        ? { runId: latestRun.runId, status: latestRun.status, reason: latestRun.reason ?? null }
        : null,
    },
  };
}

export const selfUpgradePack: ToolPack = {
  packId: "self-upgrade",
  definitions,
  handlers: {
    request_self_upgrade: requestSelfUpgradeTool,
    get_self_upgrade_queue_status: getSelfUpgradeQueueStatusTool,
  },
  grants: {
    request_self_upgrade: ["admin_write"],
    get_self_upgrade_queue_status: ["release_plan_read"],
  },
};
