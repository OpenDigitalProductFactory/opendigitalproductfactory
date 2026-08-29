import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { getSelfUpgradeConfig } from "@/lib/self-upgrade/config";
import { readSelfUpgradeSupport } from "@/lib/self-upgrade/support";
import { isUpgradeWindowOpen } from "@/lib/self-upgrade/window";
import { resolveAutoUpgradeWindow } from "@/lib/self-upgrade/auto-window";
import { getActiveSelfUpgradeBlackout } from "@/lib/self-upgrade/blackout";
import { resolveOperatingScheduleForSystem } from "@/lib/operating-hours-read";
import { getLastCheckedAt, recordCheckedAt, isCheckIntervalElapsed } from "@/lib/self-upgrade/last-check";
import { buildFetchCommand, buildRemoteHeadCommand } from "@/lib/self-upgrade/version";
import {
  loadReleaseInstallContext,
  resolveReleaseUpgradeCandidate,
  resolveUpgradeStrategy,
  type ReleaseTargetResult,
} from "@/lib/self-upgrade/release-target";
import {
  countPendingUpstreamCommits,
  evaluateReleaseBatch,
} from "@/lib/self-upgrade/release-batch";
import { prepareUpgradeSource, defaultGitRunner } from "@/lib/self-upgrade/prepare-source";
// Pure constant only: never statically import the spawn-heavy promoter runtime
// that is what the dynamic loadPromoterRuntime() below is for.
import { PROMOTER_ALREADY_RUNNING_EXIT_CODE } from "@/lib/self-upgrade/promoter-exit-codes";
import {
  resolveReadinessBackupHostPath,
  runCandidatePreflight,
  loadInstallStateSigningContext,
  verifyMigrationHandoff,
} from "@/lib/self-upgrade/preflight";
import { evaluateHostMemoryGuard } from "@/lib/self-upgrade/host-memory-preflight";
import { getDeployedSha, isFeatureBuildDeployed } from "@/lib/self-upgrade/completion";
import { readCurrentContainerConfigDigest } from "@/lib/self-upgrade/runtime-image-identity";
import {
  classifyBuildFailure,
  formatClassifiedExcerpt,
} from "@/lib/self-upgrade/build-failure-classifier";
import {
  createRun,
  startRun,
  completeRun,
  failRun,
  skipRun,
  updateRunPlan,
  recordRunRecoveryPoint,
  recordPromoterReadiness,
  getLatestRun,
  getLatestSucceededRun,
} from "@/lib/self-upgrade/run-store";
import {
  getCooldownUntil,
  isInCooldown,
  recordCooldown,
  clearCooldown,
  DEFAULT_COOLDOWN_MINUTES,
} from "@/lib/self-upgrade/cooldown";
import { emitUpgradeEvent } from "@/lib/self-upgrade/notifications";
import {
  createSelfUpgradeRecoveryPoint,
  summarizeRecoveryPointDegradation,
  summarizeRecoveryPointFailure,
} from "@/lib/self-upgrade/recovery-point";
import {
  startQuiescence,
  signalSwapStarting,
  signalSwapComplete,
  failQuiescenceSwap,
} from "@/lib/self-upgrade/quiescence";
import { rejectDuplicateSelfUpgradeDelivery } from "@/lib/self-upgrade/delivery-admission";
import {
  SELF_UPGRADE_CRON,
  SELF_UPGRADE_EVENT,
  SELF_UPGRADE_FUNCTION_ID_MANUAL,
  SELF_UPGRADE_FUNCTION_ID_SCHEDULED,
  type SelfUpgradeRunEventData,
} from "./self-upgrade-contract";

export {
  SELF_UPGRADE_CRON,
  SELF_UPGRADE_EVENT,
  SELF_UPGRADE_FUNCTION_ID_MANUAL,
  SELF_UPGRADE_FUNCTION_ID_SCHEDULED,
  type SelfUpgradeRunEventData,
} from "./self-upgrade-contract";

type PromoterRuntime = Pick<
  typeof import("@/lib/self-upgrade/promoter"),
  "isPromoterAvailable" | "ensurePromoterImage" | "buildCandidatePromoterImage" | "resolvePromoterArtifact" | "runPromoterReadiness" | "runPromoter"
>;

async function loadPromoterRuntime(): Promise<PromoterRuntime> {
  return await import("@/lib/self-upgrade/promoter");
}

export async function runSelfUpgrade(
  params: SelfUpgradeRunEventData,
): Promise<Record<string, unknown>> {
  const duplicate = await rejectDuplicateSelfUpgradeDelivery(params.runId);
  if (duplicate) return duplicate;
  const config = await getSelfUpgradeConfig();
  const now = new Date();
  const cooldownMinutes = config.cooldownMinutes ?? DEFAULT_COOLDOWN_MINUTES;

  async function skipAttempt(
    reason: string,
    persistedReason = reason,
    extra: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    if (params.runId) await skipRun(params.runId, persistedReason);
    return {
      skipped: true,
      reason,
      ...(params.runId ? { runId: params.runId } : {}),
      ...extra,
    };
  }

  const support = await readSelfUpgradeSupport(config.enabled);
  if (!support.supported) {
    return await skipAttempt(
      "unsupported-install-mode",
      `unsupported-install-mode: ${support.reason}`,
      {
        supportReason: support.reason,
        targetKind: support.targetKind,
        message: support.message,
      },
    );
  }

  if (!config.enabled && !params.dryRun) return await skipAttempt("disabled");

  // Cooldown backoff. After a deferred or failed drain we set a cooldown so the
  // NEXT attempt — from ANY trigger (scheduled cron, manual `ops/self-upgrade.run`
  // event, autonomous deploy) — waits instead of re-draining the portal within
  // minutes. This is what breaks the live draining↔normal cycle that refuses
  // every MCP/UX action ~5 of every 6 minutes. Operator force / dry-run bypass
  // it (the operator is asking now).
  if (!params.dryRun && !params.force) {
    const cooldownUntil = await getCooldownUntil();
    if (isInCooldown(cooldownUntil, now)) {
      const cooldownIso = cooldownUntil?.toISOString() ?? null;
      return await skipAttempt(
        "cooldown",
        cooldownIso ? `cooldown: ${cooldownIso}` : "cooldown",
        { cooldownUntil: cooldownIso },
      );
    }
  }
  // The upgrade window ("whenever the storefront is closed", derived from
  // operating hours) gates ONLY the unattended scheduled poll. A manual operator
  // trigger means "upgrade now" — the operator has explicitly chosen this moment,
  // so it is NOT window-gated (it still drains via quiescence below unless force).
  // force is never set by the cron.
  //
  // Effective-window precedence: an explicit operator-configured maintenanceWindows
  // array wins; otherwise, for an effectively-24/7 store with a known timezone, an
  // auto-selected low-traffic overnight window (BI-A6382FB9) — without which a 24/7
  // store would never open a window and scheduled upgrades would never run; otherwise
  // the operating-hours "store closed" derivation. A 24/7 store with no derivable
  // timezone can't be scheduled safely (any local hour could be peak), so it skips
  // with a distinct reason and the Upgrade Center prompts for a timezone — a clean
  // no-op (no drain, no cooldown), never a silent never-runs.
  if (params.scheduled && !params.force) {
    // Operator blackout gate (BI-59591B14): a declared no-change period pauses the
    // unattended upgrade. A self-upgrade is a disruptive (standard) change, so it
    // respects the same blackouts that gate other changes — unless the blackout
    // excepts self-upgrade. Manual / force bypass. Clean no-op skip (no drain, no
    // cooldown); it resumes automatically once the blackout ends. This is the
    // proactive guard quiescence can't provide (a blackout may be declared ahead
    // of time with nothing yet running).
    const blackout = await getActiveSelfUpgradeBlackout(now);
    if (blackout) {
      return await skipAttempt(
        "blackout-period",
        `blackout-period: ${blackout.name} until ${blackout.endAt.toISOString()}`,
        { blackoutUntil: blackout.endAt.toISOString() },
      );
    }
    const { schedule, timezone, timezoneKnown, lowTrafficWindows } =
      await resolveOperatingScheduleForSystem();
    const auto =
      config.maintenanceWindows.length > 0
        ? null
        : resolveAutoUpgradeWindow({ schedule, timeZone: timezone, timezoneKnown, lowTrafficWindows });
    if (auto?.kind === "needs-timezone") {
      return await skipAttempt("no-window-needs-timezone");
    }
    const explicitWindows =
      config.maintenanceWindows.length > 0
        ? config.maintenanceWindows
        : auto?.kind === "auto-overnight"
          ? auto.windows
          : undefined;
    const allowed = isUpgradeWindowOpen({ explicitWindows, schedule, timeZone: timezone });
    if (!allowed) return await skipAttempt("outside-window");
  }

  // checkIntervalHours throttle: only the scheduled cron is rate-limited, so the
  // hourly tick polls no more often than the operator configured. Manual/forced
  // runs are never throttled (the operator is asking now) but still reset the
  // clock below.
  if (params.scheduled && !params.dryRun && !params.force) {
    const lastCheckedAt = await getLastCheckedAt();
    if (!isCheckIntervalElapsed(lastCheckedAt, config.checkIntervalHours, now)) {
      return await skipAttempt("interval-not-elapsed");
    }
  }

  // Promoter-availability precheck — skip BEFORE any drain. A swap is impossible
  // without the promoter image, so if it isn't on the daemon we must NOT drain
  // the portal (which would burn the full quiescence budget and then fail at
  // `docker run`). This is the live symptom: promoterImage `dpf-promoter` was
  // never built, yet the portal kept draining. dryRun never swaps, so it skips
  // this check.
  //
  // Auto-heal (BI-F2C53237): the promoter image is buildable from files baked
  // into the portal at /promoter/ (the same recipe the promotion path uses), so
  // rather than strand a non-technical operator with a `docker build` command,
  // build it here — still BEFORE any drain — and only skip if the build itself
  // fails (or a custom/registry image is configured, which the operator pulls).
  // A skip here remains a clean no-op: no cooldown, and the next tick re-checks.
  if (!params.dryRun && config.readinessMode === "legacy-bootstrap") {
    const { ensurePromoterImage } = await loadPromoterRuntime();
    // ALWAYS rebuild the promoter before a swap, not only when its image is absent.
    // The promoter bakes promote.sh into its image (Dockerfile.promoter ENTRYPOINT), so a
    // promoter image built by an EARLIER portal version carries THAT version's promote.sh.
    // Reusing a stale-but-present image means a promote.sh fix shipped in the portal never
    // reaches the promoter that runs it — the live symptom: an install whose dpf-promoter
    // predated BET-5 ran the old promote.sh, so the pgvector-recreate (step 3a) and the
    // Neo4j/Qdrant decommission (step 7c) silently never executed and the upgrade died at
    // migrate. ensurePromoterImage() rebuilds JIT-buildable images from the portal's baked
    // /promoter/ files every time (custom/registry images are still left to the operator's
    // pull), keeping the promoter's promote.sh in lock-step with the running portal.
    const ensured = await ensurePromoterImage(config.promoterImage);
    if (!ensured.ok) {
      const promoterImage = config.promoterImage ?? "dpf-promoter";
      return await skipAttempt(
        "promoter-unavailable",
        `promoter-unavailable: ${promoterImage}`,
        { promoterImage },
      );
    }
  }

  // Activity precheck — skip BEFORE any drain (mirrors the promoter precheck
  // above). This fixes the live periodic bad-state bug (BI-F36E7510): the
  // coordinator flips the portal to `draining` (refusing every mutation/MCP
  // action) and THEN waits the full ~5min budget for the in-flight BuildPhaseRun
  // / coworker loop to quiesce — but Build Studio phases routinely outlast the
  // budget, so it times out and defers ("quiescence-deferred:
  // build-studio.phase.plan") having refused work the entire time, then sets a
  // cooldown and retries, repeating the drain every cycle. Snapshot the active
  // surfaces FIRST; if anything is in flight, skip cleanly (no drain, no
  // cooldown) and let the next tick retry once the surfaces are idle. This is the
  // same snapshot the coordinator drains against, so "empty here" means the drain
  // would converge immediately. force/dryRun bypass (the operator is asking now).
  if (!params.dryRun && !params.force) {
    const { captureActiveSessionBlockers } = await import("@/lib/self-upgrade/quiescence");
    const snapshot = await captureActiveSessionBlockers();
    // A manual operator "Upgrade now" must not silently no-op on the operator's
    // OWN session. The B-class soft blocker `request.recent-tool-execution`
    // fires on the very clicks / MCP calls that drove this trigger, so counting
    // soft surfaces here makes a manual upgrade un-runnable while the operator is
    // driving the portal — forcing Emergency override for a routine deploy
    // (BI-CC82B9A8). Only genuine in-flight work (hard blockers: coworker
    // reasoning loops, build-studio phases) early-skips a MANUAL trigger;
    // otherwise it proceeds into the quiescence drain, which converges
    // immediately when no hard work is running (a forced run reaches
    // ready-to-swap at once with only soft activity present) and otherwise
    // defers with a real run + reason rather than a silent skip. The unattended
    // scheduled poll keeps the conservative "any surface skips" behavior — it
    // must never start a drain while ANY work is in flight (BI-F36E7510).
    const blocking = params.scheduled
      ? snapshot.surfaces
      : snapshot.surfaces.filter((s) => s.kind === "hard");
    if (blocking.length > 0) {
      const surfaces = blocking.map((s) => s.surface);
      return await skipAttempt(
        "activity-in-flight",
        `activity-in-flight: ${surfaces.join(", ")}`,
        { surfaces },
      );
    }
  }

  // A real target check is proceeding now — reset the interval clock
  // (scheduled, manual, or forced; never on dryRun). Keep this after local
  // pre-drain guards so a missing promoter/active work does not delay the next
  // scheduled poll while producing no useful run history.
  if (!params.dryRun) await recordCheckedAt(now);

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

  const composeFiles =
    config.composeFiles ??
    (process.env.DPF_SELF_UPGRADE_COMPOSE_FILES
      ? process.env.DPF_SELF_UPGRADE_COMPOSE_FILES.split(/\s+/).filter(Boolean)
      : undefined);
  const composeProject =
    config.composeProject ?? process.env.COMPOSE_PROJECT_NAME ?? undefined;

  const releaseInstall = await loadReleaseInstallContext({ hostSourcePath });
  const upgradeStrategy = resolveUpgradeStrategy(config.sourceMode, releaseInstall);
  const promotionComposeFiles = composeFiles ?? releaseInstall?.composeFiles;

  let upstreamSha: string | null = null;
  let releaseTarget: Exclude<ReleaseTargetResult, { kind: "no-published-target" }> | null = null;
  const deployedSha = await getDeployedSha();
  if (upgradeStrategy === "release" && releaseInstall) {
    const currentConfigDigest = await readCurrentContainerConfigDigest();
    const target = await resolveReleaseUpgradeCandidate({
      context: releaseInstall,
      currentConfigDigest,
    });
    if (target.kind === "no-published-target") {
      return await skipAttempt("no-published-target", `no-published-target: ${target.reason}`, { releaseStatus: target.reason });
    }
    if (target.kind === "up-to-date" && !params.force && !params.dryRun) {
      return await skipAttempt("up-to-date", `up-to-date: ${target.tag}`, {
        releaseTag: target.tag,
        upstreamSha: target.sourceSha,
      });
    }
    upstreamSha = target.sourceSha;
    releaseTarget = target;
  } else if (config.sourceMode === "upstream") {
    await gitRun(buildFetchCommand({ hostSourcePath, remote, branch }).slice(1));
    const head = await gitRun(buildRemoteHeadCommand({ hostSourcePath, remote, branch }).slice(1));
    upstreamSha = head.code === 0 ? head.stdout.trim() : null;
    if (!upstreamSha) return await skipAttempt("no-target");
    const lastOk = await getLatestSucceededRun();
    if (!params.dryRun && !params.force && lastOk?.targetSha === upstreamSha) {
      const deployedSha = await getDeployedSha();
      if (deployedSha?.toLowerCase() === upstreamSha.toLowerCase()) {
        return await skipAttempt("up-to-date", `up-to-date: ${upstreamSha}`, { upstreamSha });
      }
    }
    if ((params.scheduled || params.routine) && !params.dryRun && !params.force) {
      const sinceSha = lastOk?.targetSha ?? null;
      const tally = sinceSha
        ? await countPendingUpstreamCommits(
            { hostSourcePath, remote, branch, sinceSha },
            gitRun,
          )
        : { pendingCount: null, oldestPendingAt: null };
      const batch = evaluateReleaseBatch({
        tally,
        minPendingPrs: config.batchMinPendingPrs,
        maxWaitHours: config.batchMaxWaitHours,
        now,
      });
      if (!batch.eligible) {
        return await skipAttempt(
          "batch-below-threshold",
          `batch-below-threshold: ${batch.pendingCount}/${batch.minPendingPrs} PRs pending`,
          {
            pendingPrCount: batch.pendingCount,
            batchMinPendingPrs: batch.minPendingPrs,
            batchMaxWaitHours: batch.maxWaitHours,
            oldestPendingAt: batch.oldestPendingAt?.toISOString() ?? null,
          },
        );
      }
    }
  }

  const latestRun = await getLatestRun();
  if (
    latestRun &&
    (latestRun.status === "running" ||
      latestRun.status === "queued" ||
      latestRun.status === "pending") &&
    latestRun.runId !== params.runId
  ) {
    return await skipAttempt("active-run", `active-run: ${latestRun.runId}`, {
      activeRunId: latestRun.runId,
    });
  }

  let builtStamp: string;
  if (params.dryRun) {
    builtStamp = upstreamSha ?? deployedSha ?? "dry-run";
  } else if (upgradeStrategy === "release") {
    builtStamp = upstreamSha!;
  } else {
    const prep = await prepareUpgradeSource(
      {
        sourceMode: config.sourceMode,
        hostSourcePath,
        remote,
        branch,
        installBranch: config.installBranch,
        workspacePath: upgradeWorkspaceMountPath,
      },
      gitRun,
    );
    if (!prep.ok) {
      // Conflict / no-target / prep-error: record for audit, do NOT drain or
      // swap. A merge conflict defers (operator resolves in the Upgrade Center);
      // the current build keeps running.
      const failedRun = params.runId
        ? await updateRunPlan(params.runId, {
            fromVersion: deployedSha ?? undefined,
            toVersion: upstreamSha ?? undefined,
          })
        : await createRun({
            triggeredBy: params.triggeredBy,
            fromVersion: deployedSha ?? undefined,
            toVersion: upstreamSha ?? undefined,
          });
      const reason =
        prep.reason === "merge-conflict"
          ? `merge-conflict: ${prep.conflictFiles.join(", ")}`
          : `${prep.reason}: ${prep.message}`;
      await failRun(failedRun.runId, reason);
      // Back off so a persistent conflict / prep error (which needs operator
      // resolution) doesn't re-attempt every tick and spam failed runs.
      await recordCooldown(now, cooldownMinutes);
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

  // Nothing-newer guard — skip BEFORE drain. If the honest built identity is
  // already what the runtime reports as deployed, there is nothing to swap, so
  // do NOT drain. The upstream lineage gate above catches the common pre-merge
  // case; this catches the post-merge case where the merge produced no new
  // commit (the install branch already contained upstream) and the stamp equals
  // the running SHA. A clean no-op: no run row, no QuiescenceRun, no cooldown.
  // force/dryRun bypass (operator asked; dry-run never swaps).
  if (!params.dryRun && !params.force && deployedSha && builtStamp === deployedSha) {
    return await skipAttempt("up-to-date", `up-to-date: ${builtStamp}`, { builtStamp });
  }

  if (upgradeStrategy === "source" && !params.dryRun && !params.force) {
    const guard = await evaluateHostMemoryGuard();
    if (guard.defer) {
      await recordCooldown(now, cooldownMinutes);
      return await skipAttempt("host-memory-pressure", guard.reason, guard.extra);
    }
  }

  const run = params.runId
    ? await updateRunPlan(params.runId, {
        fromVersion: deployedSha ?? undefined,
        // targetSha column carries the upstream lineage marker (what the build
        // contains), falling back to the built stamp in local mode.
        toVersion: upstreamSha ?? builtStamp,
        // deployedSha carries the expected runtime identity the rebuilt image will
        // report after boot. In upstream mode this is the install-branch merge
        // commit, not the upstream lineage marker above.
        expectedDeployedSha: builtStamp,
      })
    : await createRun({
        triggeredBy: params.triggeredBy,
        fromVersion: deployedSha ?? undefined,
        toVersion: upstreamSha ?? builtStamp,
        expectedDeployedSha: builtStamp,
      });
  await startRun(run.runId);
  await emitUpgradeEvent({ type: "upgrade.started", runId: run.runId });

  // Candidate-owned preflight. Resolve once, validate the embedded contract,
  // run readiness against that digest, persist evidence, and only then drain.
  // Undefined mode is the post-floor default; legacy-bootstrap is explicit.
  const emitFailure = (runId: string) => emitUpgradeEvent({ type: "upgrade.failed", runId });
  const signingContext = await loadInstallStateSigningContext({
    dryRun: params.dryRun, runId: run.runId, failRun, emitFailure,
  });
  if (!signingContext.ok) return { ok: false, status: "failed", runId: run.runId, reason: "installer-state-repair-required", excerpt: signingContext.reason };
  const { runtimeTransitionSecret, hostIdentity } = signingContext;
  const release = releaseTarget && releaseInstall
    ? { tag: releaseTarget.tag, ghcrOwner: releaseInstall.ghcrOwner, channelDigest: releaseTarget.channelDigest,
        platformManifestDigest: releaseTarget.platformManifestDigest, configDigest: releaseTarget.configDigest,
        platformOs: releaseTarget.platformOs, platformArchitecture: releaseTarget.platformArchitecture }
    : undefined;
  const preflight = await runCandidatePreflight({
    dryRun: params.dryRun, readinessMode: config.readinessMode, readinessOwner: config.readinessOwner,
    promoterImage: config.promoterImage, callerProtocolVersion: config.callerProtocolVersion,
    candidatePromoterReference: release
      ? `ghcr.io/${release.ghcrOwner}/dpf-promoter:${release.tag}`
      : undefined,
    release,
    sourcePath: upgradeWorkspaceMountPath ?? hostSourcePath,
    hostInstallPath: upgradeWorkspaceHostPath ?? hostInstallPathResolved,
    canonicalInstallPath: hostInstallPathResolved, targetSha: builtStamp, baselineSha: deployedSha,
    runId: run.runId, composeFiles: promotionComposeFiles ?? [], composeProject,
    healthUrl: config.healthUrl ?? process.env.PROMOTE_HEALTH_URL ?? "",
    runtime: loadPromoterRuntime, recordReadiness: recordPromoterReadiness, failRun,
    emitFailure,
    hostIdentity, runtimeTransitionSecret,
  });
  if (!preflight.ok) {
    // Back off so a residual preflight failure (an OOM under the guard floor, or a
    // readiness refusal) doesn't re-attempt the heavy build every cron tick.
    await recordCooldown(now, cooldownMinutes);
    return { ok: false, status: "failed", runId: run.runId, reason: preflight.reason };
  }
  const resolvedPromoterDigest = preflight.resolvedPromoterDigest;
  const migrationHandoff = preflight.migrationHandoff;
  const handoff = await verifyMigrationHandoff({
    dryRun: params.dryRun, runId: run.runId, migrationHandoff, resolvedPromoterDigest,
    runtimeTransitionSecret, hostIdentity, failRun, emitFailure,
  });
  if (!handoff.ok) return { ok: false, status: "failed", runId: run.runId, reason: "installer-state-repair-required", excerpt: handoff.reason };

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
      // Stamp the QuiescenceRun with the real target identity so the drain is
      // never recorded against an empty bundle. We only reach here once a
      // concrete bundle to swap to has been resolved (the nothing-newer guard
      // above already short-circuited the no-op case).
      targetVersion: upstreamSha ?? builtStamp,
      targetBundleHash: builtStamp,
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
      // Back off before the next attempt. A defer means an active session held
      // the drain; without a cooldown the next trigger would re-drain within
      // seconds and refuse work again. The level is already back to normal
      // (coordinator on defer/abort/fail) — the cooldown keeps it that way.
      await recordCooldown(now, cooldownMinutes);
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

  const recoveryPoint = await createSelfUpgradeRecoveryPoint({
    runId: run.runId,
    dryRun: params.dryRun,
  });
  await recordRunRecoveryPoint(run.runId, recoveryPoint);
  if (recoveryPoint.status === "degraded") {
    // A best-effort (derived-store) backup failed — neo4j (code/knowledge
    // graph) and qdrant (vectors) rebuild from source, so this does NOT block
    // the upgrade. Record it loudly for the operator audit trail and proceed.
    const note = summarizeRecoveryPointDegradation(recoveryPoint);
    if (note) console.warn(`[self-upgrade] ${run.runId}: ${note}`);
  }
  if (recoveryPoint.status === "failed") {
    const reason = summarizeRecoveryPointFailure(recoveryPoint);
    if (quiescenceRunId) await failQuiescenceSwap(quiescenceRunId, reason);
    await failRun(run.runId, reason);
    await recordCooldown(now, cooldownMinutes);
    await emitUpgradeEvent({
      type: "upgrade.failed",
      runId: run.runId,
      payload: { reason },
    });
    return {
      ok: false,
      status: "failed",
      runId: run.runId,
      quiescenceRunId,
      reason: "recovery-point-failed",
      recoveryPoint,
      excerpt: reason,
    };
  }

  // Signal swap-starting for audit; record the moment we cross the
  // ready-to-swap → actually-swapping boundary on the QuiescenceRun.
  // No-op when quiescenceRunId is null (dryRun path).
  if (quiescenceRunId) {
    await signalSwapStarting(quiescenceRunId);
  }

  let result: { exitCode: number; stdout: string; stderr: string };
  try {
    const { runPromoter } = await loadPromoterRuntime();
    result = await runPromoter({
      // HOST path of the install tree, bind-mounted into the promoter container.
      // Daemon-resolved host path, not an in-portal path; hostSourceMountPath
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
      backupHostPath: resolveReadinessBackupHostPath(process.env.DPF_BACKUPS_HOST_PATH, hostInstallPathResolved ?? ""),
      composeEnvFileHostPath: hostInstallPathResolved
        ? `${hostInstallPathResolved.replace(/\/$/, "")}/.env`
        : undefined,
      // Recreate the portal with the install's own platform chain so an overlay
      // (linux ollama URL, macOS host TTS) is applied only on the host that
      // recorded it — never force-applied to the wrong substrate.
      composeFiles: promotionComposeFiles,
      composeProject,
      healthUrl: config.healthUrl ?? process.env.PROMOTE_HEALTH_URL ?? "",
      promoterImage: resolvedPromoterDigest ?? config.promoterImage,
      release,
      stateDirHostPath: process.env.DPF_STATE_DIR_HOST,
      installStateMigrationEnvelope: migrationHandoff ? Buffer.from(JSON.stringify(migrationHandoff.envelope)).toString("base64url") : undefined,
      installStateMigrationSignature: migrationHandoff?.signature,
      installStateMigrationRunId: migrationHandoff?.envelope.runId,
      installStateMigrationHandoff: migrationHandoff,
      dryRun: params.dryRun,
      // Deterministic name so a stalled build can be force-removed by name on
      // timeout (runPromoter) or by the watchdog backstop. docker names allow
      // [A-Za-z0-9_.-]; runId (e.g. SUR-756751D1) is already safe.
      containerName: `dpf-promoter-${run.runId}`,
    });
  } catch (err) {
    // The promoter failed to even spawn (e.g. docker missing). Without this
    // catch the rejection would bubble up as an Inngest function error and
    // leave the run stuck "running" — blocking every future trigger.
    const msg = err instanceof Error ? err.message : String(err);
    if (quiescenceRunId) await failQuiescenceSwap(quiescenceRunId, msg);
    await failRun(run.runId, `promoter-spawn-error: ${msg}`);
    await recordCooldown(now, cooldownMinutes);
    await emitUpgradeEvent({ type: "upgrade.failed", runId: run.runId });
    return { ok: false, status: "failed", runId: run.runId, quiescenceRunId, excerpt: msg };
  }

  if (result.exitCode === PROMOTER_ALREADY_RUNNING_EXIT_CODE) {
    // A concurrent/retried dispatch for THIS runId found a promoter already
    // building it (runPromoter's idempotency guard declined to launch a
    // duplicate). Leave run state untouched — the owning dispatch, and as a
    // backstop the stuck-run watchdog, finalizes the run. Calling failRun here
    // is exactly the SUR-E2BF265E defect: a healthy in-flight build recorded as
    // failed because a second `docker run` collided on the deterministic name.
    // No cooldown, no failure event — this dispatch is a no-op, not a failure.
    return {
      ok: true,
      status: "already-in-flight",
      runId: run.runId,
      quiescenceRunId,
      note: result.stderr.trim(),
    };
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
    // Clear any prior cooldown — a swap succeeded, so the backoff from an
    // earlier defer/fail no longer applies.
    if (!params.dryRun) await clearCooldown();
    await emitUpgradeEvent({ type: "upgrade.succeeded", runId: run.runId });
    const deployed = params.buildId ? await isFeatureBuildDeployed(params.buildId) : null;
    return { ok: true, status: "succeeded", runId: run.runId, quiescenceRunId, deployed };
  }

  // Persist a tail of BOTH streams: with the classic builder the failing RUN
  // step's output (e.g. pnpm's actual fetch error) is on stdout while compose
  // writes only progress lines to stderr — `stderr || stdout` threw the real
  // error away (SUR-73668D5C persisted no pnpm output at all).
  const streamTail = (s: string) => (s.length > 4000 ? `…${s.slice(-4000)}` : s);
  const rawExcerpt =
    [
      result.stderr && `--- stderr (tail) ---\n${streamTail(result.stderr)}`,
      result.stdout && `--- stdout (tail) ---\n${streamTail(result.stdout)}`,
    ]
      .filter(Boolean)
      .join("\n") || "unknown error";
  // Classify the build-gate failure into a known recurring class so the
  // persisted failure — and the BLOCKED reason an agent reads downstream —
  // leads with an actionable diagnosis instead of a raw log to reproduce from
  // zero (BI-E4CBC7C1; spec §3.3).
  const failureClass = classifyBuildFailure({
    log: `${result.stdout}\n${result.stderr}`,
  });
  const excerpt = formatClassifiedExcerpt(failureClass, rawExcerpt);
  // Promoter failed — signal failure to the coordinator so it transitions
  // to failed + flips level back to normal (critical: without this, the
  // portal stays draining forever after a failed swap).
  if (quiescenceRunId) {
    await failQuiescenceSwap(quiescenceRunId, excerpt);
  }
  await failRun(run.runId, excerpt);
  await recordCooldown(now, cooldownMinutes);
  await emitUpgradeEvent({ type: "upgrade.failed", runId: run.runId });
  return {
    ok: false,
    status: "failed",
    runId: run.runId,
    quiescenceRunId,
    exitCode: result.exitCode,
    failureClass: failureClass.class,
    excerpt,
  };
}

// Self-upgrade is the PRIORITY LANE (admission-control spec §4.3): deliberately
// NOT enrolled in the dpf-build-pipeline lane (apps/web/lib/queue/admission.ts),
// so when an operator caps that lane it always has account-concurrency headroom
// below the build/agent flood — a queued "Upgrade now" never sits behind builds.
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
    try {
      return await step.run("run-self-upgrade-manual", () => runSelfUpgrade(data));
    } catch (err) {
      if (data.runId) {
        const msg = err instanceof Error ? err.message : String(err);
        try {
          await failRun(data.runId, `worker-error: ${msg}`);
        } catch {
          // Preserve the original Inngest failure; DB recovery failure is secondary.
        }
      }
      throw err;
    }
  },
);
