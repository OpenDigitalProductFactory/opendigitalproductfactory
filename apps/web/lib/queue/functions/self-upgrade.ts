import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { getSelfUpgradeConfig, isInMaintenanceWindow } from "@/lib/self-upgrade/config";
import { resolveTargetSha, isShaFresh } from "@/lib/self-upgrade/version";
import { getDeployedSha, isFeatureBuildDeployed } from "@/lib/self-upgrade/completion";
import { createRun, startRun, completeRun, failRun, getLatestRun } from "@/lib/self-upgrade/run-store";
import { runPromoter } from "@/lib/self-upgrade/promoter";
import { emitUpgradeEvent } from "@/lib/self-upgrade/notifications";

export const SELF_UPGRADE_FUNCTION_ID_SCHEDULED = "ops/self-upgrade-scheduled";
export const SELF_UPGRADE_FUNCTION_ID_MANUAL = "ops/self-upgrade-manual";
export const SELF_UPGRADE_CRON = "0 * * * *";
export const SELF_UPGRADE_EVENT = "ops/self-upgrade.run";

export type SelfUpgradeRunEventData = {
  triggeredBy?: string;
  dryRun?: boolean;
  buildId?: string;
};

export async function runSelfUpgrade(
  params: SelfUpgradeRunEventData,
): Promise<Record<string, unknown>> {
  const config = await getSelfUpgradeConfig();

  if (!config.enabled && !params.dryRun) return { skipped: true, reason: "disabled" };
  if (!isInMaintenanceWindow(config) && !params.dryRun) return { skipped: true, reason: "outside-window" };

  const targetSha = await resolveTargetSha(config.channel);
  if (!targetSha) return { skipped: true, reason: "no-target" };

  const deployedSha = getDeployedSha();
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

  const result = await runPromoter({
    sourcePath: process.env.PROMOTE_SOURCE ?? "",
    targetSha,
    backupPath: process.env.PROMOTE_BACKUP_PATH ?? "",
    healthUrl: process.env.PROMOTE_HEALTH_URL ?? "",
    dryRun: params.dryRun,
  });

  if (result.exitCode === 0) {
    await completeRun(run.runId);
    await emitUpgradeEvent({ type: "upgrade.succeeded", runId: run.runId });
    const deployed = params.buildId ? await isFeatureBuildDeployed(params.buildId) : null;
    return { ok: true, status: "succeeded", runId: run.runId, deployed };
  }

  const excerpt = result.stderr || result.stdout || "unknown error";
  await failRun(run.runId, excerpt);
  await emitUpgradeEvent({ type: "upgrade.failed", runId: run.runId });
  return { ok: false, status: "failed", runId: run.runId, exitCode: result.exitCode, excerpt };
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
