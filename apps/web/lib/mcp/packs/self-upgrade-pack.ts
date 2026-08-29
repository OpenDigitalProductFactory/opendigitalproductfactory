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
    // destroys state → consult-gated (TAK §8.4.1).
    consequence: "irreversible",
  },
  {
    name: "repair_promoter_image",
    description:
      "Build the promoter engine image on this host so the governed self-upgrade can swap the portal. This is the governed remedy for the 'Upgrade engine not ready — promoter image not built' skip: the build inputs are baked into the portal image, so the platform builds it in place instead of asking a human to run a docker command. Idempotent — if the image is already present it reports so without rebuilding. Only the default local image is buildable this way; a custom or registry-qualified promoter image is pull-based and must be provided by the operator.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    requiredCapability: "manage_provider_connections",
    executionMode: "immediate",
    sideEffect: true,
    // destroys state → consult-gated (TAK §8.4.1).
    consequence: "irreversible",
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
  {
    name: "get_quiescence_status",
    description:
      "Read quiescence, blockers, write availability, coordinator state, and retry guidance before CI or mutating MCP writes. " +
      "Call once at the start of a write/CI sequence; when level is normal and writesRefused is false, do not re-poll every tool call. " +
      "Re-check only after a refused write, a self-upgrade notice, or when retryAfterSeconds elapses.",
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

  if (result.status === "unsupported_install_mode") {
    return {
      success: true,
      message: result.message,
      data: result as unknown as Record<string, unknown>,
    };
  }

  return {
    success: false,
    error: "Unexpected self-upgrade admission state.",
    message: "Unexpected self-upgrade admission state.",
  };
}

async function repairPromoterImageTool(): Promise<ToolResult> {
  const [{ getSelfUpgradeConfig }, { readSelfUpgradeSupport }] = await Promise.all([
    import("@/lib/self-upgrade/config"),
    import("@/lib/self-upgrade/support"),
  ]);
  const config = await getSelfUpgradeConfig();
  const support = await readSelfUpgradeSupport(config.enabled);
  if (!support.supported) {
    return {
      success: true,
      message: support.message,
      data: support as unknown as Record<string, unknown>,
    };
  }

  if (support.targetKind === "release-artifact") {
    return {
      success: true,
      message: "Release installs pull the promoter that belongs to the verified target release; no source-built promoter repair is needed.",
      data: {
        ...support,
        repairMode: "release-managed",
      } as unknown as Record<string, unknown>,
    };
  }

  const { ensurePromoterImage } = await import("@/lib/self-upgrade/promoter");
  const image = config.promoterImage ?? "dpf-promoter";
  const result = await ensurePromoterImage(config.promoterImage);

  if (result.ok && result.alreadyPresent) {
    return {
      success: true,
      message: `The promoter engine image (${image}) is already built — self-upgrade can swap the portal. Nothing to repair.`,
      data: result as unknown as Record<string, unknown>,
    };
  }

  if (result.ok && result.built) {
    return {
      success: true,
      message: `Built the promoter engine image (${image}). The next self-upgrade attempt resumes automatically — no further action needed.`,
      data: result as unknown as Record<string, unknown>,
    };
  }

  const why =
    result.skipReason === "custom-image"
      ? `A custom promoter image (${image}) is configured; it must be pulled by the operator rather than built here.`
      : `Could not build the promoter engine image${
          result.detail ? `: ${result.detail.split("\n").pop()}` : "."
        }`;
  return {
    success: false,
    error: why,
    message: why,
    data: result as unknown as Record<string, unknown>,
  };
}

async function getSelfUpgradeQueueStatusTool(): Promise<ToolResult> {
  const [
    { resolveReleaseBatchStatus },
    { getSelfUpgradeConfig },
    { getLatestRun },
  ] =
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
  const support = batch.support;
  return {
    success: true,
    message: support.message ?? batch.summary,
    data: {
      configuredEnabled: support.configuredEnabled,
      supported: support.supported,
      enabled: support.enabled,
      targetKind: support.targetKind,
      sourceMode: config.sourceMode,
      batchingApplicable: support.supported && batch.applicable,
      routineUpgradeEligible: support.enabled && batch.eligible,
      reason: support.supported ? batch.reason : support.reason,
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

async function getQuiescenceStatusTool(): Promise<ToolResult> {
  const { getQuiescenceActivity } = await import("@/lib/self-upgrade/quiescence");
  const activity = await getQuiescenceActivity();
  const activeTaskCount = activity.blockers.reduce((sum, blocker) => sum + blocker.count, 0);
  const writesRefused = activity.level !== "normal";
  const trigger = activity.run?.trigger ?? null;
  const retryAfterSeconds = writesRefused ? 30 : 0;

  return {
    success: true,
    message: writesRefused
      ? `Portal is ${activity.level}; mutating MCP writes are refused until quiescence clears.`
      : "Portal quiescence is normal; MCP writes are accepted.",
    data: {
      level: activity.level,
      runId: activity.runId,
      enteredAt: activity.enteredAt,
      trigger,
      activeCoordinator: activity.run
        ? {
            kind: trigger,
            runId: activity.run.runId,
            status: activity.run.status,
            targetVersion: activity.run.targetVersion,
            targetBundleHash: activity.run.targetBundleHash,
            drainStartedAt: activity.run.drainStartedAt,
            lastHeartbeatAt: activity.run.lastHeartbeatAt,
            budgetMs: activity.run.budgetMs,
            deferSurface: activity.run.deferSurface,
            deferReason: activity.run.deferReason,
          }
        : null,
      blockersCapturedAt: activity.blockersCapturedAt,
      drainBlockers: activity.blockers,
      activeTaskCount,
      retryAfterSeconds,
      writesRefused,
      readOperationsAllowed: true,
      cleanupOperationsAllowed: ["release_nonprod_environment_lease"],
      refusedOperations: writesRefused
        ? ["mutating MCP writes", "new lease claims", "local-CI evidence writes"]
        : [],
      writeImplications: writesRefused
        ? "Mutating MCP writes are refused during active quiescence; retry after the level returns to normal. Lease release remains cleanup-safe so local-CI can finalize without leaking a lease."
        : "Mutating MCP writes are accepted. Continue normal local-CI evidence recording and lease operations.",
    },
  };
}

export const selfUpgradePack: ToolPack = {
  packId: "self-upgrade",
  definitions,
  handlers: {
    request_self_upgrade: requestSelfUpgradeTool,
    repair_promoter_image: repairPromoterImageTool,
    get_self_upgrade_queue_status: getSelfUpgradeQueueStatusTool,
    get_quiescence_status: getQuiescenceStatusTool,
  },
  grants: {
    request_self_upgrade: ["admin_write"],
    // Same scope as request_self_upgrade — the platform-engineer ("AI Ops
    // Engineer") coworker already holds admin_write, so the repair is reachable
    // by the ops coworker with no new grant.
    repair_promoter_image: ["admin_write"],
    get_self_upgrade_queue_status: ["release_plan_read"],
    get_quiescence_status: ["release_plan_read"],
  },
};
