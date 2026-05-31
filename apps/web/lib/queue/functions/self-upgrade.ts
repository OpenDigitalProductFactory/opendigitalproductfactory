import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { getSelfUpgradeConfig } from "@/lib/self-upgrade/config";
import { isUpgradeWindowOpen } from "@/lib/self-upgrade/window";
import { resolveOperatingScheduleForSystem } from "@/lib/operating-hours-read";
import { getLastCheckedAt, recordCheckedAt, isCheckIntervalElapsed } from "@/lib/self-upgrade/last-check";
import { buildFetchCommand, buildRemoteHeadCommand } from "@/lib/self-upgrade/version";
import { prepareUpgradeSource, defaultGitRunner } from "@/lib/self-upgrade/prepare-source";
import { getDeployedSha, isFeatureBuildDeployed } from "@/lib/self-upgrade/completion";
import {
  createRun,
  startRun,
  completeRun,
  failRun,
  getLatestRun,
  getLatestSucceededRun,
} from "@/lib/self-upgrade/run-store";
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
  /**
   * Set only by the scheduled cron. Gates the run on checkIntervalHours so the
   * hourly tick polls no more often than the operator configured. Manual runs
   * leave this unset and are never interval-throttled.
   */
  scheduled?: boolean;
};

export async function runSelfUpgrade(
  params: SelfUpgradeRunEventData,
): Promise<Record<string, unknown>> {
  const config = await getSelfUpgradeConfig();

  if (!config.enabled && !params.dryRun) return { skipped: true, reason: "disabled" };
  // The upgrade window ("whenever the storefront is closed", derived from
  // operating hours) gates ONLY the unattended scheduled poll. A manual operator
  // trigger means "upgrade now" — the operator has explicitly chosen this moment,
  // so it is NOT window-gated (it still drains via quiescence below unless force).
  // An explicit maintenanceWindows config overrides the derived window for the
  // scheduled path. force never set by the cron.
  if (params.scheduled && !params.force) {
    const { schedule, timezone } = await resolveOperatingScheduleForSystem();
    const allowed = isUpgradeWindowOpen({
      explicitWindows: config.maintenanceWindows,
      schedule,
      timeZone: timezone,
    });
    if (!allowed) return { skipped: true, reason: "outside-window" };
  }

  // checkIntervalHours throttle: only the scheduled cron is rate-limited, so the
  // hourly tick polls no more often than the operator configured. Manual/forced
  // runs are never throttled (the operator is asking now) but still reset the
  // clock below.
  if (params.scheduled && !params.dryRun && !params.force) {
    const lastCheckedAt = await getLastCheckedAt();
    if (!isCheckIntervalElapsed(lastCheckedAt, config.checkIntervalHours, new Date())) {
      return { skipped: true, reason: "interval-not-elapsed" };
    }
  }
  // A real check is proceeding now — reset the interval clock (scheduled, manual,
  // or forced; never on dryRun).
  if (!params.dryRun) await recordCheckedAt(new Date());

  const gitRun = defaultGitRunner;
  const hostSourcePath =
    config.hostSourceMountPath ??
    process.env.DPF_SELF_UPGRADE_HOST_SOURCE_MOUNT ??
    process.env.HOST_SOURCE_PATH ??
    "/host-dpf";
  const remote = config.repositoryRemote ?? process.env.REPO_REMOTE ?? "origin";
  const branch = config.repositoryBranch ?? process.env.REPO_BRANCH ?? "main";
  // BI-A8A7CCFD — workspace-isolated upgrade source. The workspace lives as a
  // subdirectory of the install clone so it's visible inside BOTH the portal
  // container's existing `/host-dpf` mount AND the promoter's `/host-source`
  // mount, with no docker-compose change required.
  const upgradeWorkspaceMountPath = config.useIsolatedWorkspace
    ? config.upgradeWorkspaceMountPath ?? `${hostSourcePath.replace(/\/$/, "")}/.upgrade-workspace`
    : undefined;
  const hostInstallPathResolved =
    config.hostInstallPath ??
    process.env.DPF_HOST_INSTALL_PATH ??
    process.env.PROMOTE_SOURCE ??
    "";
  const upgradeWorkspaceHostPath =
    config.useIsolatedWorkspace && hostInstallPathResolved
      ? config.upgradeWorkspaceHostPath ?? `${hostInstallPathResolved.replace(/\/$/, "")}/.upgrade-workspace`
      : undefined;

  // ── Detection: resolve the upstream target and apply the lineage gate ──────
  // In upstream mode we fetch first (fresh ref) and skip when the running build
  // already contains this upstream SHA. The running deployedSha is the merge
  // identity, NOT the upstream SHA it absorbed, so freshness is gated on the
  // latest succeeded run's targetSha (the upstream lineage marker), per §5.0.
  let upstreamSha: string | null = null;
  if (config.sourceMode === "upstream") {
    await gitRun(buildFetchCommand({ hostSourcePath, remote, branch }).slice(1));
    const head = await gitRun(buildRemoteHeadCommand({ hostSourcePath, remote, branch }).slice(1));
    upstreamSha = head.code === 0 ? head.stdout.trim() : null;
    if (!upstreamSha) return { skipped: true, reason: "no-target" };

    const lastOk = await getLatestSucceededRun();
    if (!params.dryRun && !params.force && lastOk?.targetSha === upstreamSha) {
      return { skipped: true, reason: "up-to-date", upstreamSha };
    }
  }

  const latestRun = await getLatestRun();
  if (latestRun?.status === "running") {
    return { skipped: true, reason: "active-run", runId: latestRun.runId };
  }

  const deployedSha = await getDeployedSha();

  // ── Source preparation: merge upstream into the durable install branch
  // (upstream) or stamp the working tree (local). The honest stamp returned
  // here is the identity the promoter must build and verify. dryRun must not
  // mutate the host clone, so the merge is skipped and a placeholder stamp used.
  let builtStamp: string;
  if (params.dryRun) {
    builtStamp = upstreamSha ?? deployedSha ?? "dry-run";
  } else {
    const prep = await prepareUpgradeSource(
      {
        sourceMode: config.sourceMode,
        hostSourcePath,
        remote,
        branch,
        installBranch: config.installBranch,
        // BI-A8A7CCFD — pass the in-container workspace path when isolation is
        // enabled. prepare-source switches to the workspace-merge code path
        // automatically; undefined falls back to the legacy direct-merge.
        workspacePath: upgradeWorkspaceMountPath,
      },
      gitRun,
    );
    if (!prep.ok) {
      // Conflict / no-target / prep-error: record for audit, do NOT drain or
      // swap. A merge conflict defers (operator resolves in the Upgrade Center);
      // the current build keeps running.
      const failedRun = await createRun({
        triggeredBy: params.triggeredBy,
        fromVersion: deployedSha ?? undefined,
        toVersion: upstreamSha ?? undefined,
      });
      const reason =
        prep.reason === "merge-conflict"
          ? `merge-conflict: ${prep.conflictFiles.join(", ")}`
          : `${prep.reason}: ${prep.message}`;
      await failRun(failedRun.runId, reason);
      await emitUpgradeEvent({ type: "upgrade.failed", runId: failedRun.runId });
      return {
        ok: false,
        status: prep.reason === "merge-conflict" ? "deferred-conflict" : "failed",
        runId: failedRun.runId,
        reason: prep.reason,
        conflictFiles: prep.reason === "merge-conflict" ? prep.conflictFiles : undefined,
      };
    }
    builtStamp = prep.stamp;
    upstreamSha = prep.upstreamSha ?? upstreamSha;
  }

  const run = await createRun({
    triggeredBy: params.triggeredBy,
    fromVersion: deployedSha ?? undefined,
    // targetSha column carries the upstream lineage marker (what the build
    // contains), falling back to the built stamp in local mode.
    toVersion: upstreamSha ?? builtStamp,
    // deployedSha carries the expected runtime identity the rebuilt image will
    // report after boot. In upstream mode this is the install-branch merge
    // commit, not the upstream lineage marker above.
    expectedDeployedSha: builtStamp,
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

  let result: { exitCode: number; stdout: string; stderr: string };
  try {
    result = await runPromoter({
      // HOST path of the install tree, bind-mounted into the promoter
      // container. Daemon-resolved, so it must be a host path (not an
      // in-portal path). hostSourceMountPath is the in-container mount and
      // is no longer passed — runPromoter mounts to a fixed /host-source.
      // BI-A8A7CCFD — when isolated workspace is on, the promoter builds from
      // the workspace HOST path (which holds the merged tree), not the
      // operator's install clone. The promoter mounts whatever we hand it
      // here at `/host-source:ro` — same contract, just a different host dir.
      hostInstallPath: upgradeWorkspaceHostPath ?? hostInstallPathResolved,
      // The honest built identity from source prep (merge-commit SHA in upstream
      // mode, HEAD/-dirty in local mode). promote.sh re-derives this from the
      // tree's HEAD and cross-checks against it.
      targetSha: builtStamp,
      backupPath: process.env.PROMOTE_BACKUP_PATH ?? `/backups/self-upgrade/${run.runId}`,
      backupHostPath: process.env.DPF_BACKUPS_HOST_PATH ?? undefined,
      healthUrl: config.healthUrl ?? process.env.PROMOTE_HEALTH_URL ?? "",
      promoterImage: config.promoterImage,
      dryRun: params.dryRun,
    });
  } catch (err) {
    // The promoter failed to even spawn (e.g. docker missing). Without this
    // catch the rejection would bubble up as an Inngest function error and
    // leave the run stuck "running" — blocking every future trigger.
    const msg = err instanceof Error ? err.message : String(err);
    if (quiescenceRunId) await failQuiescenceSwap(quiescenceRunId, msg);
    await failRun(run.runId, `promoter-spawn-error: ${msg}`);
    await emitUpgradeEvent({ type: "upgrade.failed", runId: run.runId });
    return { ok: false, status: "failed", runId: run.runId, quiescenceRunId, excerpt: msg };
  }

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
      runSelfUpgrade({ triggeredBy: "scheduled", scheduled: true }),
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
