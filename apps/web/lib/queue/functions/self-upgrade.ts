import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { getSelfUpgradeConfig, isInMaintenanceWindow } from "@/lib/self-upgrade/config";
import { resolveTargetSha, isShaFresh } from "@/lib/self-upgrade/version";
import { getDeployedSha, isFeatureBuildDeployed } from "@/lib/self-upgrade/completion";
import { createRun, startRun, completeRun, failRun, getLatestRun } from "@/lib/self-upgrade/run-store";
import { runPromoter } from "@/lib/self-upgrade/promoter";
import { emitUpgradeEvent } from "@/lib/self-upgrade/notifications";
import {
  startQuiescence,
  signalSwapStarting,
  signalSwapComplete,
  failQuiescenceSwap,
} from "@/lib/self-upgrade/quiescence";

export const SELF_UPGRADE_FUNCTION_ID_SCHEDULED = "ops/self-upgrade-scheduled";
export const SELF_UPGRADE_FUNCTION_ID_MANUAL = "ops/self-upgrade-manual";
export const SELF_UPGRADE_CRON = "0 * * * *";
export const SELF_UPGRADE_EVENT = "ops/self-upgrade.run";

export type SelfUpgradeRunEventData = {
  triggeredBy?: string;
  dryRun?: boolean;
  buildId?: string;
  /**
   * Operator emergency override. Bypasses the maintenance-window gate so a
   * manual trigger runs immediately, AND force-applies even when quiescence
   * would defer the upgrade (surfaces as ship-force to the coordinator, which
   * records the override on QuiescenceRun.forcedSurfaces for audit).
   * Operator-confirmed only; never set by the scheduled cron.
   */
  force?: boolean;
  /**
   * Wait budget in ms to pass to the coordinator. Defaults to the
   * coordinator's own DEFAULT_BUDGET_MS (5 minutes). Operators can
   * raise/lower per upgrade attempt.
   */
  budgetMs?: number;
};

export async function runSelfUpgrade(
  params: SelfUpgradeRunEventData,
): Promise<Record<string, unknown>> {
  const config = await getSelfUpgradeConfig();

  if (!config.enabled && !params.dryRun) return { skipped: true, reason: "disabled" };
  // force = operator emergency override: bypass the maintenance window (and,
  // below, the quiescence defer). Never set by the scheduled cron.
  if (!isInMaintenanceWindow(config) && !params.dryRun && !params.force) {
    return { skipped: true, reason: "outside-window" };
  }

  const targetSha = await resolveTargetSha(config.channel, config);
  if (!targetSha) return { skipped: true, reason: "no-target" };

  const deployedSha = await getDeployedSha();
  if (isShaFresh(deployedSha, targetSha)) return { skipped: true, reason: "up-to-date" };

  const latestRun = await getLatestRun();
  if (latestRun?.status === "running") {
    return { skipped: true, reason: "active-run", runId: latestRun.runId };
  }

  const run = await createRun({
    triggeredBy: params.triggeredBy,
    fromVersion: deployedSha ?? undefined,
    toVersion: targetSha,
  });
  await startRun(run.runId);
  await emitUpgradeEvent({ type: "upgrade.started", runId: run.runId });

  // BI-QUIESCE-010 keystone integration: replaces the single-signal
  // getPortalActivity check with the full Activity Quiescence Protocol
  // coordinator (BI-QUIESCE-002). The coordinator inventories all 30
  // active surfaces, drains them in dependency order, and either
  // signals ready-to-swap or defers with a specific blocker surface.
  //
  // dryRun bypasses the drain entirely (no level flip, no caller
  // events). force surfaces as shipForce so the coordinator records
  // the override on forcedSurfaces.
  let quiescenceRunId: string | null = null;
  if (!params.dryRun) {
    const { runId: qRunId, awaitReady } = await startQuiescence({
      trigger: "self-upgrade",
      triggerRefId: run.runId,
      budgetMs: params.budgetMs,
      shipForce: params.force,
    });
    quiescenceRunId = qRunId;

    const outcome = await awaitReady();
    if (!outcome.ok) {
      // Coordinator deferred / aborted / failed — no swap should happen.
      // The upgrade run itself is marked failed so the audit trail is
      // complete; the next cron tick will retry.
      await failRun(
        run.runId,
        outcome.outcome === "deferred"
          ? `quiescence-deferred: ${outcome.deferSurface ?? "unknown"}`
          : `quiescence-${outcome.outcome}: ${("reason" in outcome ? outcome.reason : null) ?? "unknown"}`,
      );
      await emitUpgradeEvent({ type: "upgrade.failed", runId: run.runId });
      return {
        ok: false,
        status: "deferred",
        runId: run.runId,
        quiescenceRunId,
        reason: outcome.outcome,
        deferSurface: outcome.outcome === "deferred" ? outcome.deferSurface : null,
      };
    }
  }

  // Signal swap-starting for audit; record the moment we cross the
  // ready-to-swap → actually-swapping boundary on the QuiescenceRun.
  // No-op when quiescenceRunId is null (dryRun path).
  if (quiescenceRunId) {
    await signalSwapStarting(quiescenceRunId);
  }

  const result = await runPromoter({
    // HOST path of the install tree, bind-mounted into the promoter
    // container. Daemon-resolved, so it must be a host path (not an
    // in-portal path). hostSourceMountPath is the in-container mount and
    // is no longer passed — runPromoter mounts to a fixed /host-source.
    hostInstallPath:
      config.hostInstallPath ??
      process.env.DPF_HOST_INSTALL_PATH ??
      process.env.PROMOTE_SOURCE ??
      "",
    targetSha,
    backupPath: process.env.PROMOTE_BACKUP_PATH ?? `/backups/self-upgrade/${run.runId}`,
    backupHostPath: process.env.DPF_BACKUPS_HOST_PATH ?? undefined,
    healthUrl: config.healthUrl ?? process.env.PROMOTE_HEALTH_URL ?? "",
    promoterImage: config.promoterImage,
    dryRun: params.dryRun,
  });

  if (result.exitCode === 0) {
    // Signal swap-complete BEFORE marking the upgrade succeeded so the
    // coordinator transitions through swapping→completed and flips the
    // level back to normal as fast as possible. Suspended Inngest
    // functions wake up via platform.quiescence-cleared.
    if (quiescenceRunId) {
      await signalSwapComplete(quiescenceRunId);
    }
    await completeRun(run.runId);
    await emitUpgradeEvent({ type: "upgrade.succeeded", runId: run.runId });
    const deployed = params.buildId ? await isFeatureBuildDeployed(params.buildId) : null;
    return { ok: true, status: "succeeded", runId: run.runId, quiescenceRunId, deployed };
  }

  const excerpt = result.stderr || result.stdout || "unknown error";
  // Promoter failed — signal failure to the coordinator so it transitions
  // to failed + flips level back to normal (critical: without this, the
  // portal stays draining forever after a failed swap).
  if (quiescenceRunId) {
    await failQuiescenceSwap(quiescenceRunId, excerpt);
  }
  await failRun(run.runId, excerpt);
  await emitUpgradeEvent({ type: "upgrade.failed", runId: run.runId });
  return {
    ok: false,
    status: "failed",
    runId: run.runId,
    quiescenceRunId,
    exitCode: result.exitCode,
    excerpt,
  };
}

export const selfUpgradeScheduled = inngest.createFunction(
  {
    id: SELF_UPGRADE_FUNCTION_ID_SCHEDULED,
    retries: 1,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron(SELF_UPGRADE_CRON)],
  },
  async ({ step }) => {
    return await step.run("run-self-upgrade-scheduled", () =>
      runSelfUpgrade({ triggeredBy: "scheduled" }),
    );
  },
);

export const selfUpgradeManual = inngest.createFunction(
  {
    id: SELF_UPGRADE_FUNCTION_ID_MANUAL,
    retries: 0,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [{ event: SELF_UPGRADE_EVENT }],
  },
  async ({ event, step }) => {
    const data = event.data as SelfUpgradeRunEventData;
    return await step.run("run-self-upgrade-manual", () => runSelfUpgrade(data));
  },
);
