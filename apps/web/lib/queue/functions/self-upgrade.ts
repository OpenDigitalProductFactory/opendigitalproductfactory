import { cron } from "@/lib/jobs/triggers";
import { jobs } from "@/lib/jobs";
import { getSelfUpgradeConfig } from "@/lib/self-upgrade/config";
import { readSelfUpgradeSupport } from "@/lib/self-upgrade/support";
import { isUpgradeWindowOpen } from "@/lib/self-upgrade/window";
import { resolveAutoUpgradeWindow } from "@/lib/self-upgrade/auto-window";
import { getActiveSelfUpgradeBlackout } from "@/lib/self-upgrade/blackout";
import { resolveOperatingScheduleForSystem } from "@/lib/operating-hours-read";
import { getLastCheckedAt, recordCheckedAt, isCheckIntervalElapsed } from "@/lib/self-upgrade/last-check";
import { buildFetchCommand, buildRemoteHeadCommand } from "@/lib/self-upgrade/version";
import { loadReleaseInstallContext, resolveUpgradeStrategy, type ReleaseTargetResult } from "@/lib/self-upgrade/release-target";
import { resolveWorkerReleaseTarget } from "@/lib/self-upgrade/worker-release-target";
import { countPendingUpstreamCommits, evaluateReleaseBatch } from "@/lib/self-upgrade/release-batch";
import { prepareUpgradeSource, defaultGitRunner } from "@/lib/self-upgrade/prepare-source";
import {
  runCandidatePreflight,
  loadInstallStateSigningContext,
  verifyMigrationHandoff,
} from "@/lib/self-upgrade/preflight";
import { evaluateHostMemoryGuard } from "@/lib/self-upgrade/host-memory-preflight";
import { getDeployedSha } from "@/lib/self-upgrade/completion";
import { readCurrentContainerConfigDigest } from "@/lib/self-upgrade/runtime-image-identity";
import {
  createRun,
  startRun,
  failRun,
  skipRun,
  cancelRun,
  updateRunPlan,
  recordPromoterReadiness,
  getLatestRun,
  getLatestSucceededRun,
} from "@/lib/self-upgrade/run-store";
import {
  getCooldownUntil,
  isInCooldown,
  recordCooldown,
  DEFAULT_COOLDOWN_MINUTES,
} from "@/lib/self-upgrade/cooldown";
import { emitUpgradeEvent } from "@/lib/self-upgrade/notifications";
import { startQuiescence, type QuiescenceOutcome } from "@/lib/self-upgrade/quiescence";
import { DEFAULT_DRAIN_WAIT_BUDGET_MS } from "@/lib/self-upgrade/drain-wait";
import { finishSelfUpgrade, type SelfUpgradeSwapContext } from "./self-upgrade-swap";
import { runSelfUpgradeInSteps, type SelfUpgradeBegin, type SelfUpgradePhases } from "./self-upgrade-steps";
import { rejectDuplicateSelfUpgradeDelivery } from "@/lib/self-upgrade/delivery-admission";
import { evaluateScheduledGate, recordScheduledDecline } from "@/lib/self-upgrade/scheduled-gate";
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

/**
 * The whole upgrade in-process: pre-drain, wait, swap. The job functions below
 * run the same phases as separate steps (runSelfUpgradeInSteps); this composed
 * form keeps a single call for tests and in-process callers.
 */
export async function runSelfUpgrade(
  params: SelfUpgradeRunEventData,
): Promise<Record<string, unknown>> {
  const begun = await beginSelfUpgrade(params);
  if ("done" in begun) return begun.done;
  const ctx = begun.draining;
  if (begun.awaitReady) {
    const settled = await settleDrainOutcome(ctx, await begun.awaitReady());
    if (settled) return settled;
  }
  return await finishSelfUpgrade(ctx);
}

/** Everything before the swap: gates, source prep, preflight, and the drain start. */
export async function beginSelfUpgrade(params: SelfUpgradeRunEventData): Promise<SelfUpgradeBegin> {
  const done = (result: Record<string, unknown>): SelfUpgradeBegin => ({ done: result });
  const duplicate = await rejectDuplicateSelfUpgradeDelivery(params.runId);
  if (duplicate) return done(duplicate);
  const config = await getSelfUpgradeConfig();
  const now = new Date();
  const cooldownMinutes = config.cooldownMinutes ?? DEFAULT_COOLDOWN_MINUTES;

  async function skipAttempt(
    reason: string,
    persistedReason = reason,
    extra: Record<string, unknown> = {},
  ): Promise<SelfUpgradeBegin> {
    if (params.runId) await skipRun(params.runId, persistedReason);
    // BI-3CA18934: the scheduled cron carries no runId, so without this a
    // declined unattended tick left NO trace at all — no row, no reason — and
    // the only evidence was the absence of a run, which reads like a broken
    // scheduler. Record it where the status tool can retrieve it.
    else if (params.scheduled) await recordScheduledDecline(persistedReason, now);
    return done({
      skipped: true,
      reason,
      ...(params.runId ? { runId: params.runId } : {}),
      ...extra,
    });
  }

  // An upgrade can now wait hours for work. A scheduled fire during one exits
  // here, before any costly check: no drain, no cooldown (BI-F9EE05E5).
  const activeRunOf = (r: Awaited<ReturnType<typeof getLatestRun>>) =>
    r && ["running", "queued", "pending"].includes(r.status) && r.runId !== params.runId ? r : null;
  const activeAtStart = params.scheduled ? activeRunOf(await getLatestRun()) : null;
  if (activeAtStart) {
    return await skipAttempt("active-run", `active-run: ${activeAtStart.runId}`, { activeRunId: activeAtStart.runId });
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
  // Every unattended gate — blackout, window, interval — now lives in
  // scheduled-gate.ts beside the status that reports it (BI-3CA18934).
  if (params.scheduled && !params.force) {
    const decline = await evaluateScheduledGate({ config, now, dryRun: params.dryRun });
    if (decline) {
      return await skipAttempt(decline.reason, decline.persistedReason ?? decline.reason, decline.extra ?? {});
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
    // legacy-datastore decommission (step 7c) silently never executed and the upgrade died at
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

  // BI-F9EE05E5 (spec §11a): no activity precheck. Work in flight never skips
  // an upgrade (that skip, BI-F36E7510, ended 92 of 134 live runs "skipped"):
  // manual and scheduled runs both enter the drain below, which closes
  // admission to new work, lets in-flight work finish, and waits up to
  // drainWaitBudgetMs before pausing for the operator.

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
    const resolution = await resolveWorkerReleaseTarget({
      runId: params.runId,
      context: releaseInstall,
      currentConfigDigest,
    });
    if (resolution.kind === "handled") return done(resolution.response);
    if (resolution.kind === "unavailable") {
      return await skipAttempt(
        "no-published-target",
        `no-published-target: ${resolution.target.reason}`,
        { releaseStatus: resolution.target.reason },
      );
    }
    const target = resolution.target;
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

  const latestRun = activeRunOf(await getLatestRun());
  if (latestRun) {
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
      return done({
        ok: false,
        status: prep.reason === "merge-conflict" ? "deferred-conflict" : "failed",
        runId: failedRun.runId,
        reason: prep.reason,
        conflictFiles: prep.reason === "merge-conflict" ? prep.conflictFiles : undefined,
      });
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
  if (!signingContext.ok) return done({ ok: false, status: "failed", runId: run.runId, reason: "installer-state-repair-required", excerpt: signingContext.reason });
  const { runtimeTransitionSecret, hostIdentity } = signingContext;
  const release = releaseTarget && releaseInstall
    ? { tag: releaseTarget.tag, ghcrOwner: releaseInstall.ghcrOwner, channelDigest: releaseTarget.channelDigest,
        platformManifestDigest: releaseTarget.platformManifestDigest, configDigest: releaseTarget.configDigest,
        platformOs: releaseTarget.platformOs, platformArchitecture: releaseTarget.platformArchitecture }
    : undefined;
  // Kept as a value so the post-drain handoff refresh can re-run the SAME
  // readiness (identical candidate, target and identity) if the install-state
  // moved while the portal drained. The plain part crosses to the swap step.
  const preflightPlan: SelfUpgradeSwapContext["preflight"] = {
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
  };
  const preflight = await runCandidatePreflight({
    ...preflightPlan, runtime: loadPromoterRuntime, recordReadiness: recordPromoterReadiness, failRun,
    emitFailure, hostIdentity, runtimeTransitionSecret,
  });
  if (!preflight.ok) {
    // Back off so a residual preflight failure (an OOM under the guard floor, or a
    // readiness refusal) doesn't re-attempt the heavy build every cron tick.
    await recordCooldown(now, cooldownMinutes);
    return done({ ok: false, status: "failed", runId: run.runId, reason: preflight.reason });
  }
  const resolvedPromoterDigest = preflight.resolvedPromoterDigest;
  const migrationHandoff = preflight.migrationHandoff;
  const handoff = await verifyMigrationHandoff({
    dryRun: params.dryRun, runId: run.runId, migrationHandoff, resolvedPromoterDigest,
    runtimeTransitionSecret, hostIdentity, failRun, emitFailure,
  });
  if (!handoff.ok) return done({ ok: false, status: "failed", runId: run.runId, reason: "installer-state-repair-required", excerpt: handoff.reason });

  // BI-QUIESCE-010 keystone integration: the full Activity Quiescence Protocol
  // coordinator (BI-QUIESCE-002) drains every active surface in dependency
  // order. BI-F9EE05E5: admission closes first; in-flight work is not stopped;
  // the drain waits up to drainWaitBudgetMs (default 60 min), then pauses as
  // awaiting-operator rather than deferring.
  //
  // dryRun bypasses the drain entirely (no level flip, no caller
  // events). force surfaces as shipForce so the coordinator records
  // the override on forcedSurfaces.
  let quiescenceRunId: string | null = null;
  let awaitReady: (() => Promise<QuiescenceOutcome>) | undefined;
  if (!params.dryRun) {
    const started = await startQuiescence({
      trigger: "self-upgrade",
      triggerRefId: run.runId,
      budgetMs: params.budgetMs ?? config.drainWaitBudgetMs ?? DEFAULT_DRAIN_WAIT_BUDGET_MS,
      shipForce: params.force,
      // Stamp the QuiescenceRun with the real target identity so the drain is
      // never recorded against an empty bundle (the nothing-newer guard above
      // already short-circuited the no-op case).
      targetVersion: upstreamSha ?? builtStamp,
      targetBundleHash: builtStamp,
    });
    quiescenceRunId = started.runId;
    awaitReady = started.awaitReady;
  }

  // Plain JSON for the swap step; functions and the signing secret are
  // re-supplied there (self-upgrade-swap.ts).
  const ctx: SelfUpgradeSwapContext = {
    runId: run.runId, quiescenceRunId, dryRun: params.dryRun, force: params.force, buildId: params.buildId, cooldownMinutes, builtStamp,
    promoter: {
      hostInstallPath: upgradeWorkspaceHostPath ?? hostInstallPathResolved,
      canonicalInstallPath: hostInstallPathResolved,
      composeFiles: promotionComposeFiles, composeProject,
      healthUrl: config.healthUrl ?? process.env.PROMOTE_HEALTH_URL ?? "",
      promoterImage: config.promoterImage, release,
    },
    preflight: preflightPlan, migrationHandoff, resolvedPromoterDigest,
  };
  return { draining: ctx, awaitReady };
}

/**
 * Record what the drain ended in. Returns the run's final result to stop, or
 * null to go on to the swap. BI-F9EE05E5: waiting is never a failure — this
 * runs only once the drain has an outcome. An operator Abort ends the run
 * cancelled with its reason (no failure record, no cooldown); a coordinator
 * failure or a (non-upgrade) defer still fails the run and backs off.
 */
export async function settleDrainOutcome(
  ctx: SelfUpgradeSwapContext,
  outcome: QuiescenceOutcome,
): Promise<Record<string, unknown> | null> {
  if (outcome.ok) return null;
  const base = { ok: false, runId: ctx.runId, quiescenceRunId: ctx.quiescenceRunId, reason: outcome.outcome };
  if (outcome.outcome === "aborted") {
    await cancelRun(ctx.runId, `operator-aborted: ${outcome.reason}`);
    await emitUpgradeEvent({ type: "upgrade.cancelled", runId: ctx.runId });
    return { ...base, status: "aborted" };
  }
  await failRun(
    ctx.runId,
    outcome.outcome === "deferred"
      ? `quiescence-deferred: ${outcome.deferSurface ?? "unknown"}`
      : `quiescence-${outcome.outcome}: ${outcome.reason ?? "unknown"}`,
  );
  // Back off so a failed drain is not re-entered within seconds. The level is
  // already back to normal (the coordinator's terminal path).
  await recordCooldown(new Date(), ctx.cooldownMinutes);
  await emitUpgradeEvent({ type: "upgrade.failed", runId: ctx.runId });
  return { ...base, status: "deferred", deferSurface: outcome.outcome === "deferred" ? outcome.deferSurface : null };
}

const SELF_UPGRADE_PHASES: SelfUpgradePhases = {
  begin: beginSelfUpgrade,
  settle: settleDrainOutcome,
  finish: finishSelfUpgrade,
};

// Self-upgrade is the PRIORITY LANE (admission-control spec §4.3): deliberately
// NOT enrolled in the dpf-build-pipeline lane (apps/web/lib/queue/admission.ts),
// so when an operator caps that lane it always has account-concurrency headroom
// below the build/agent flood — a queued "Upgrade now" never sits behind builds.
export const selfUpgradeScheduled = jobs.createFunction(
  {
    id: SELF_UPGRADE_FUNCTION_ID_SCHEDULED,
    retries: 1,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron(SELF_UPGRADE_CRON)],
  },
  async ({ step }) => {
    // BI-F9EE05E5: pre-drain / wait / swap as separate steps (self-upgrade-steps.ts).
    return await runSelfUpgradeInSteps(step, { triggeredBy: "scheduled", scheduled: true }, SELF_UPGRADE_PHASES);
  },
);

export const selfUpgradeManual = jobs.createFunction(
  {
    id: SELF_UPGRADE_FUNCTION_ID_MANUAL,
    retries: 0,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [{ event: SELF_UPGRADE_EVENT }],
  },
  async ({ event, step }) => {
    const data = event.data as SelfUpgradeRunEventData;
    try {
      return await runSelfUpgradeInSteps(step, data, SELF_UPGRADE_PHASES);
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
