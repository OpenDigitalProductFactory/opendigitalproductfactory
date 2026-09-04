// Next.js instrumentation hook — runs once on server startup.
// See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

import {
  areOptionalStartupTasksEnabled,
  isInngestSelfSyncOnBootEnabled,
  isStartupModelRevalidationEnabled,
} from "@/lib/runtime/env-flags";
import { isMeasurementRuntime, settleBootSync } from "@/lib/runtime/measurement-runtime";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { sweepOrphanedPromoterContainers } from "@/lib/self-upgrade/promoter-sweep";
import { reconcileSelfUpgradeAdmissions } from "@/lib/self-upgrade/admission";
import {
  resolveInngestSelfRegistrationEndpoint,
  syncInngestSelfRegistration,
} from "@/lib/queue/inngest-self-registration";
/**
 * Logs a deprecation notice when HIVE_CONTRIBUTION_TOKEN is set in the
 * environment. Exported so the instrumentation module's startup behavior
 * can be exercised by a unit test — invoking `register()` directly runs
 * a long queue of setTimeouts and DB-bound work that the test does not
 * care about.
 */
export function warnIfLegacyHiveTokenEnvSet(
  logger: Pick<Console, "warn"> = console,
): boolean {
  if (!process.env.HIVE_CONTRIBUTION_TOKEN) return false;
  logger.warn(
    "[deprecation] HIVE_CONTRIBUTION_TOKEN is deprecated. Configure GitHub auth via\n" +
      "Admin > Platform Development (OAuth Device Flow recommended once that phase ships).\n" +
      "Support for this env var will be removed 60 days after the next release.",
  );
  return true;
}

export function scheduleInitialCodeGraphBootstrap(input: {
  delayMs?: number;
  logger?: Pick<Console, "log" | "error">;
  setTimer?: (callback: () => void, delayMs: number) => unknown;
  ensure?: () => Promise<void>;
} = {}): void {
  const logger = input.logger ?? console;
  const setTimer = input.setTimer ?? setTimeout;

  setTimer(() => {
    void (async () => {
      try {
        const ensure = input.ensure ?? (async () => {
          const { ensureCodeGraphInitialized } = await import("@/lib/build/code-graph-refresh");
          await ensureCodeGraphInitialized();
        });
        await ensure();
        logger.log("[code-graph] Initial graph bootstrap complete or already present");
      } catch (err) {
        logger.error("[code-graph] Initial graph bootstrap failed:", err);
      }
    })();
  }, input.delayMs ?? 10_000);
}

/**
 * Mirror the canonical platform version (from version.json) into the
 * PlatformConfig["platform.version"] row so the DB-backed runtime metadata
 * agrees with the file-backed loader. Non-fatal: failures log loudly but
 * do not break startup (dev/test environments may not have the table or
 * may run with a partially seeded DB).
 *
 * Spec: docs/superpowers/specs/2026-05-23-governed-platform-upgrade-lifecycle-design.md §4.1
 */
export async function syncPlatformVersionOnBoot(
  logger: Pick<Console, "log" | "error"> = console,
): Promise<boolean> {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return false;
  try {
    const { syncPlatformVersionConfig } = await import("@/lib/platform/version-config");
    await syncPlatformVersionConfig();
    logger.log("[platform-version] Synced PlatformConfig platform.version");
    return true;
  } catch (err) {
    logger.error("[platform-version] Failed to sync PlatformConfig platform.version:", err);
    return false;
  }
}

/**
 * Reconcile self-upgrade runs on boot. A real upgrade recreates the portal
 * container, which kills the orchestrating process mid-swap — so it can never
 * mark its own run succeeded. The NEW portal closes the loop here: any run
 * left "running" is resolved against the SHA we actually came up on. If the
 * deployed SHA matches the run's expected deployed identity, the swap landed → succeeded;
 * otherwise the run is an orphan → failed (also clears the stuck-"running"
 * state that would otherwise block all future triggers).
 *
 * In upstream mode `targetSha` is the upstream lineage marker. The deployed
 * identity is the install-branch merge commit stored in `deployedSha` when the
 * run is created; falling back to targetSha preserves local-mode and legacy rows.
 *
 * Single-host assumption: at boot, a "running" run belongs to the swap that
 * just recreated us, not a concurrent replica. Non-fatal.
 */
export async function reconcileSelfUpgradeRunsOnBoot(
  logger: Pick<Console, "log" | "error"> = console,
  opts: { staleAfterMs?: number; now?: () => Date } = {},
): Promise<{ succeeded: number; failed: number } | null> {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return null;
  try {
    const { prisma } = await import("@dpf/db");
    const { getDeployedSha } = await import("@/lib/self-upgrade/completion");
    const { completeRun, failRun } = await import("@/lib/self-upgrade/run-store");
    const deployedSha = await getDeployedSha();
    // staleAfterMs > 0 → PERIODIC mode (called in-process on an interval, not just
    // on boot): only touch runs stuck "running" well past a normal upgrade (~7
    // min), so an in-flight swap is never reconciled out from under itself.
    // staleAfterMs = 0 (boot default) reconciles every "running" row, because a
    // boot means the orchestrating process is already gone.
    const staleAfterMs = opts.staleAfterMs ?? 0;
    const now = opts.now?.() ?? new Date();
    const running = await prisma.selfUpgradeRun.findMany({
      where:
        staleAfterMs > 0
          ? {
              status: "running",
              startedAt: { lt: new Date(now.getTime() - staleAfterMs) },
            }
          : { status: "running" },
    });
    let succeeded = 0;
    let failed = 0;
    for (const run of running) {
      const expectedDeployedSha = run.deployedSha ?? run.targetSha ?? null;
      if (
        deployedSha &&
        expectedDeployedSha &&
        expectedDeployedSha.toLowerCase() === deployedSha.toLowerCase()
      ) {
        await completeRun(run.runId);
        succeeded++;
        logger.log(`[self-upgrade-reconcile] ${run.runId} -> succeeded (deployed ${deployedSha})`);
        continue;
      }
      // Swap PENDING, not orphaned. On boot (staleAfterMs===0) we may come up still on the
      // run's PRE-upgrade SHA — e.g. the old portal restarted mid-swap before the promoter
      // recreated it on the target. Failing here is a false negative: the promoter may still
      // complete the swap (it did for SUR-F4209F75 — failed on a mid-swap boot although the
      // portal then came up healthy on the target). Leave the run "running"; the staleness-
      // guarded periodic watchdog (staleAfterMs>0) fails it only if the swap genuinely never
      // lands. The watchdog path never takes this branch, so a truly stuck run is still reaped.
      if (
        staleAfterMs === 0 &&
        deployedSha &&
        run.currentSha &&
        run.currentSha.toLowerCase() === deployedSha.toLowerCase()
      ) {
        logger.log(
          `[self-upgrade-reconcile] ${run.runId} -> swap pending (still on pre-upgrade SHA ${deployedSha}); leaving "running" for the watchdog`,
        );
        continue;
      }
      await failRun(
        run.runId,
        staleAfterMs > 0
          ? `Reconciled by watchdog (stuck "running" > ${Math.round(staleAfterMs / 60000)}m): orchestrator did not complete the swap. deployed=${deployedSha ?? "unknown"} expected=${expectedDeployedSha ?? "unknown"} target=${run.targetSha ?? "unknown"}`
          : `Reconciled on boot: orchestrator did not complete the swap. deployed=${deployedSha ?? "unknown"} expected=${expectedDeployedSha ?? "unknown"} target=${run.targetSha ?? "unknown"}`,
      );
      failed++;
      logger.log(`[self-upgrade-reconcile] ${run.runId} -> failed (orphaned)`);
    }

    // In PERIODIC mode, also fail runs stuck "queued"/"pending" that never
    // started — the dispatch event was dropped (e.g. the job engine was down),
    // so they can never run, yet requestPortalSelfUpgradeAction silently no-ops
    // on a queued/pending row and blocks every future upgrade. (SUR-B26DF3E4 had
    // to be cleared by hand during the 2026-06-14 incident.) Boot mode leaves
    // these alone — a freshly-queued run there may still be mid-dispatch.
    if (staleAfterMs > 0) {
      const staleQueued = await prisma.selfUpgradeRun.findMany({
        where: {
          status: { in: ["queued", "pending"] },
          startedAt: null,
          createdAt: { lt: new Date(now.getTime() - staleAfterMs) },
        },
      });
      for (const run of staleQueued) {
        await failRun(
          run.runId,
          `Reconciled by watchdog: dispatch never started (stuck "${run.status}" > ${Math.round(staleAfterMs / 60000)}m — the queue event was likely dropped). Re-invoke to retry.`,
        );
        failed++;
        logger.log(
          `[self-upgrade-reconcile] ${run.runId} -> failed (never-dispatched ${run.status})`,
        );
      }
    }

    if (succeeded || failed) {
      logger.log(`[self-upgrade-reconcile] resolved ${succeeded} succeeded, ${failed} failed`);
    }
    return { succeeded, failed };
  } catch (err) {
    logger.error("[self-upgrade-reconcile] failed (non-fatal):", err);
    return null;
  }
}

/**
 * Boot/periodic reconcile for QuiescenceRun rows orphaned by a self-swap — the
 * quiescence-coordinator counterpart to reconcileSelfUpgradeRunsOnBoot. A real
 * upgrade recreates this very portal, killing the orchestrator before it can
 * deliver the coordinator's swap-complete handshake; the coordinator (suspended
 * in Inngest) then runs out its full 10-minute wait and falsely records
 * `outcome=failed`, which the operator banner renders as "Upgrade postponed,
 * failed" even though the swap SUCCEEDED. The surviving portal resolves the
 * running bundle identity and lets the lib reconciler close the loop. Non-fatal.
 */
export async function reconcileQuiescenceRunsOnBoot(
  logger: Pick<Console, "log" | "warn" | "error"> = console,
  opts: { staleAfterMs?: number; now?: () => Date } = {},
): Promise<{ reconciled: number; failed: number } | null> {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return null;
  try {
    const { getDeployedSha } = await import("@/lib/self-upgrade/completion");
    const { reconcileQuiescenceOnBoot } = await import("@/lib/self-upgrade/quiescence");
    const deployedSha = await getDeployedSha();
    return await reconcileQuiescenceOnBoot({
      // A self-upgrade stores the deployed/merge identity in targetBundleHash;
      // the runtime exposes that same identity as DEPLOYED_SHA. Pass it for both
      // fields so the match is robust across upstream- and local-mode rows.
      currentVersion: deployedSha,
      currentBundleHash: deployedSha,
      staleAfterMs: opts.staleAfterMs ?? 0,
      now: opts.now?.(),
      logger,
    });
  } catch (err) {
    logger.error("[quiescence-reconcile] wrapper failed (non-fatal):", err);
    return null;
  }
}

/**
 * Self-heal a stuck quiescence level on boot. A real upgrade flips the level to
 * "draining"/"swapping" and recreates the portal — killing both the
 * orchestrator and the coordinator before either can flip it back to "normal".
 * The new portal would then read the stuck level and refuse all gated requests
 * ("portal_quiescing" 503) forever. We just booted, so any prior quiescence is
 * over: reset to normal. Non-fatal.
 */
export async function resetStuckQuiescenceLevelOnBoot(
  logger: Pick<Console, "log" | "error"> = console,
): Promise<boolean> {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return false;
  try {
    const { prisma } = await import("@dpf/db");
    const { QUIESCENCE_CONFIG_KEY, setQuiescenceLevel } = await import(
      "@/lib/self-upgrade/quiescence"
    );
    const row = await prisma.platformConfig.findUnique({
      where: { key: QUIESCENCE_CONFIG_KEY },
    });
    const level = (row?.value as { level?: string } | null)?.level ?? "normal";
    if (level !== "normal") {
      await setQuiescenceLevel("normal", null);
      logger.log(
        `[quiescence-reset] level was "${level}" on boot — reset to normal (post-swap self-heal)`,
      );
      return true;
    }
    return false;
  } catch (err) {
    logger.error("[quiescence-reset] failed (non-fatal):", err);
    return false;
  }
}

/**
 * FIX 1 (spec §3.1 engine-first / FB-78E967D4) — Contradictory-checkpoint
 * auto-recovery. A portal restart or an older buggy pipeline pass can strand a
 * build's `buildExecState` in one of three self-contradictory shapes that NO
 * existing recovery path accepts, so "Reset Build" was the only escape:
 *   • missing-step       — restart killed the pipeline before step 1
 *   • error-without-fail — a non-`failed` step carrying an error/failedAt
 *   • complete-no-verify — step=complete but verificationOut never populated
 *
 * This reconciler applies the same classification the UI uses
 * (classifyContradictoryExecState) and the shared recovery plan
 * (planExecStateRecovery) automatically, with no human:
 *   • error-without-fail → coerce to `failed` so `retryBuildExecution`'s
 *     machinery can resume from the failed step (container/port/diagnosis
 *     preserved).
 *   • missing-step / complete-no-verify → clear the checkpoint so the pipeline
 *     restarts clean (its own self-heal re-runs setup idempotently).
 *
 * Idempotent: a healthy or already-`failed` row yields `action: "none"` and is
 * skipped, so this is safe to run on every boot. Non-fatal. Exported for tests.
 */
export async function recoverContradictoryBuildExecStatesOnBoot(
  logger: Pick<Console, "log" | "error"> = console,
): Promise<{ recovered: number; cleared: number; failedCoerced: number } | null> {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return null;
  try {
    const { prisma, Prisma } = await import("@dpf/db");
    const { planExecStateRecovery } = await import("@/lib/build/build-exec-types");
    type ExecStateLike = import("@/lib/build/build-exec-types").ExecStateLike;
    // Scan only rows still in the build phase; filter the null/contradictory
    // discrimination in JS to avoid Prisma JSON-null filter subtleties.
    const candidates = await prisma.featureBuild.findMany({
      where: { phase: "build" },
      select: { buildId: true, buildExecState: true, verificationOut: true },
    });
    let cleared = 0;
    let failedCoerced = 0;
    for (const build of candidates) {
      const plan = planExecStateRecovery(
        build.buildExecState as ExecStateLike | null,
        build.verificationOut,
      );
      if (plan.action === "none") continue;
      if (plan.action === "clear") {
        await prisma.featureBuild.update({
          where: { buildId: build.buildId },
          // DbNull (SQL NULL) matches resetBuildExecution's clear semantics, so
          // the UI reads `buildExecState == null` (not contradictory) afterwards.
          data: { buildExecState: Prisma.DbNull },
        });
        cleared++;
        logger.log(
          `[build-exec-recover] ${build.buildId} -> cleared checkpoint (reason=${plan.reason}); pipeline will restart clean`,
        );
      } else {
        await prisma.featureBuild.update({
          where: { buildId: build.buildId },
          data: {
            buildExecState: plan.state as unknown as import("@dpf/db").Prisma.InputJsonValue,
          },
        });
        failedCoerced++;
        logger.log(
          `[build-exec-recover] ${build.buildId} -> coerced to failed (reason=${plan.reason}); Retry can now resume from failedAt=${plan.state.failedAt ?? "?"}`,
        );
      }
      await prisma.buildActivity
        .create({
          data: {
            buildId: build.buildId,
            tool: "recoverContradictoryBuildExecStatesOnBoot",
            summary:
              plan.action === "clear"
                ? `Auto-recovered contradictory checkpoint on boot (reason=${plan.reason}): cleared for clean restart`
                : `Auto-recovered contradictory checkpoint on boot (reason=${plan.reason}): coerced to failed for retry`,
          },
        })
        .catch(() => {});
    }
    const recovered = cleared + failedCoerced;
    if (recovered > 0) {
      logger.log(
        `[build-exec-recover] recovered ${recovered} contradictory checkpoint(s): ${cleared} cleared, ${failedCoerced} coerced to failed`,
      );
    }
    return { recovered, cleared, failedCoerced };
  } catch (err) {
    logger.error("[build-exec-recover] failed (non-fatal):", err);
    return null;
  }
}

/**
 * Advance a build stranded at the build→review boundary, mirroring the
 * orchestrator's on-completion auto-advance (build-orchestrator.ts ~1518).
 *
 * Recomputes the SCOPED verification for the build (out-of-scope failures
 * elsewhere in the repo are nulled and treated as a pass; an IN-scope failure
 * stays blocking so a genuinely-broken build is NOT force-advanced), runs the
 * `build->review` phase gate, and — only if the gate allows AND the row is
 * still `phase=build` — flips it to `review` and queues review verification.
 *
 * Returns `true` iff it advanced. Idempotent: a build already past `build`, or
 * one whose in-scope verification fails the gate, is a no-op. Non-throwing for
 * the scoped-verification step (a scope-resolution failure falls back to the
 * raw verificationOut, exactly like the orchestrator). Exported for tests.
 */
export async function advanceStrandedBuildToReview(buildId: string): Promise<boolean> {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return false;
  const { prisma } = await import("@dpf/db");
  const { canTransitionPhase } = await import("@/lib/feature-build-types");
  const { checkBuildPhaseGate } = await import("@/lib/work-posture/verification-depth-gate");

  const build = await prisma.featureBuild.findUnique({ where: { buildId } });
  if (!build || build.phase !== "build" || !canTransitionPhase("build", "review")) {
    return false;
  }

  // Scope the verification to THIS build's changed files before gating — a
  // pre-existing failure ELSEWHERE in the repo must not block the advance.
  // getScopedVerificationForBuild nulls out-of-scope failures; treat null
  // (out-of-scope only) as a pass, keep an in-scope failure (false) blocking.
  let verificationForGate: unknown = build.verificationOut;
  try {
    const { getScopedVerificationForBuild } = await import("@/lib/build/scoped-verification");
    const scoped = await getScopedVerificationForBuild(buildId);
    if (scoped) {
      verificationForGate = {
        ...((build.verificationOut ?? {}) as Record<string, unknown>),
        typecheckPassed: scoped.buildScoped.typecheckPassed ?? true,
        testsFailed: scoped.buildScoped.testsFailed ?? 0,
      };
    }
  } catch {
    // Fall back to the raw verificationOut, exactly like the orchestrator.
  }

  const gate = await checkBuildPhaseGate({
    buildId,
    from: "build",
    to: "review",
    evidence: {
      kind: build.kind,
      processSize: ((build.plan as Record<string, unknown> | null)?.processSize as string | undefined) ?? "medium",
      verificationOut: verificationForGate as typeof build.verificationOut,
    },
  });
  if (!gate.allowed) return false;

  // Guard the flip on the row still being `build` so two concurrent reconcilers
  // (or a live advance racing this one) never double-advance.
  const flipped = await prisma.featureBuild.updateMany({
    where: { buildId, phase: "build" },
    data: { phase: "review" },
  });
  if (flipped.count === 0) return false;

  const { queueBuildReviewVerification } = await import("@/lib/build-review-verification-trigger");
  await queueBuildReviewVerification(buildId);
  return true;
}

/**
 * Periodic ship→complete reconciler for the autonomous-completion path
 * (operator opt-in via DPF_AUTO_COMPLETE_VERIFIED_BUILDS, default OFF).
 *
 * A verified build that reached `ship` — with its forks set up by
 * `autoResolveShipForks` (community PR pushed + product/promotion registered) —
 * completes once its merged code is LIVE via the platform self-upgrade (the
 * deploy the operator already runs; NOT the per-build promoter). This loop
 * detects that: for each `ship`-phase build whose merged SHA is now in the
 * deployed runtime (`isFeatureBuildDeployed`), it marks the build's still-open
 * promotion(s) `deployed` — the self-upgrade WAS the deploy — so the promote
 * fork becomes terminal, then runs `reconcileBuildCompletion` to advance
 * ship→complete.
 *
 * No-op (and cheap) when the flag is off or no ship build is deployed yet.
 * Idempotent + non-throwing. Exported for tests.
 */
export async function reconcileDeployedShipBuilds(
  logger: Pick<Console, "log" | "error"> = console,
): Promise<{ completed: number } | null> {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return null;
  const { isAutoCompleteEnabled } = await import("@/lib/build/ship-on-review-approval");
  if (!isAutoCompleteEnabled()) return null;
  try {
    const { prisma } = await import("@dpf/db");
    const { reconcileBuildCompletion, completeLocalDeliveryBuild } = await import("@/lib/build-flow-state");
    const { isFeatureBuildDeployed } = await import("@/lib/self-upgrade/completion");

    const shipBuilds = await prisma.featureBuild.findMany({
      where: { phase: "ship" },
      select: { id: true, buildId: true },
    });
    const { mayCompleteAutonomousBuild } =
      await import("@/lib/build/autonomous-build-completion-gate");
    let completed = 0;
    for (const build of shipBuilds) {
      try {
        if (!(await isFeatureBuildDeployed(build.buildId))) {
          // A fully-local install treats ProductVersion registration as delivery.
          // Upstream builds no-op here and keep waiting for deployed evidence.
          if (!(await mayCompleteAutonomousBuild({ buildId: build.buildId, logger }))) continue;
          if (await completeLocalDeliveryBuild(build.buildId)) {
            completed++;
            logger.log(
              `[auto-complete] ${build.buildId} completed — delivered locally (fully-local install)`,
            );
          }
          continue;
        }
        if (!(await mayCompleteAutonomousBuild({ buildId: build.buildId, logger }))) continue;
        // Merged code is live via self-upgrade → mark the build's still-open
        // promotion(s) deployed so the promote fork is terminal. The platform
        // self-upgrade IS the deploy here (the per-build promoter is not used).
        const pvs = await prisma.productVersion.findMany({
          where: { featureBuildId: build.id },
          select: { id: true },
        });
        if (pvs.length > 0) {
          await prisma.changePromotion.updateMany({
            where: {
              productVersionId: { in: pvs.map((p) => p.id) },
              status: { in: ["pending", "approved", "scheduled", "awaiting_operator"] },
            },
            data: {
              status: "deployed",
              deployedAt: new Date(),
              rationale: "Deployed via platform self-upgrade (autonomous build completion)",
            },
          });
        }
        if (await reconcileBuildCompletion(build.buildId)) {
          completed++;
          logger.log(
            `[auto-complete] ${build.buildId} completed — merged code live via self-upgrade`,
          );
        }
      } catch (err) {
        logger.error(
          "[auto-complete] ship reconcile failed for %s: %s",
          JSON.stringify(build.buildId),
          err instanceof Error ? JSON.stringify(err.message) : JSON.stringify(String(err)),
        );
      }
    }
    return { completed };
  } catch (err) {
    logger.error(
      "[auto-complete] reconcileDeployedShipBuilds failed: %s",
      err instanceof Error ? JSON.stringify(err.message) : JSON.stringify(String(err)),
    );
    return null;
  }
}

/**
 * FIX 2 (spec §3.1 engine-first) — Restart-resume for stranded build rows. The
 * pipeline is dispatched fire-and-forget (`autoExecuteBuild(...).catch(...)`),
 * so a portal recycle silently kills it mid-flight, leaving a row in the `build`
 * phase at a non-terminal step that nothing ever picks up again — the build just
 * stops.
 *
 * This reconciler finds those rows and re-dispatches them. `autoExecuteBuild`
 * reads the persisted `buildExecState` and `runBuildPipeline` resumes from
 * `getResumeStep`, re-running the interrupted step idempotently — no work is
 * lost and no duplicate sandbox is created.
 *
 * Liveness guard: only rows whose `updatedAt` is older than `staleAfterMs`
 * (default 5 min — comfortably longer than the heartbeat-ticker cadence that
 * touches `buildExecState` during a legitimately slow step) are resumed, so a
 * genuinely in-flight build on a still-running portal is never double-dispatched.
 * Contradictory shapes are left to recoverContradictoryBuildExecStatesOnBoot
 * (which runs first); this only resumes internally-consistent, mid-step rows.
 *
 * Idempotent and safe to run every boot. Non-fatal. Exported for tests.
 */
export async function resumeStrandedBuildsOnBoot(
  opts: {
    staleAfterMs?: number;
    dispatch?: (buildId: string) => void;
    /**
     * Injectable pre-build-phase resumer (BI-9257CF19). Fire-and-forget;
     * defaults to the canonical {@link resumePreBuildPhase} importer. Injected
     * in tests so the boot reconcile can be asserted without running the real
     * generator/reviewer pipeline.
     */
    resumePreBuild?: (args: { buildId: string; phase: string; userId: string }) => void;
    /**
     * Injectable build->review transition advancer (this fix). Given a build
     * stranded at the build->review boundary (phase=`build`, step=`complete`,
     * verification populated), recomputes the SCOPED verification + the
     * `build->review` phase gate and, if allowed, advances the row to `review`
     * (the same advance the orchestrator does on normal completion). Returns
     * whether it advanced. Defaults to {@link advanceStrandedBuildToReview};
     * injected in tests so the boot reconcile can be asserted without the real
     * sandbox / scoped-verification chain.
     */
    advanceToReview?: (buildId: string) => Promise<boolean>;
    /**
     * Age-out cap (BI-A009313E). A build created longer ago than this while
     * STILL in a resumable pre-build phase (ideate/plan/review) is aged out to
     * `abandoned` instead of resumed again — capping the perpetual resume loop
     * that a self-upgrade swap re-triggers every time. Keyed on createdAt so the
     * cap is immune to the resume churn re-heartbeating the row. Defaults to
     * {@link STRANDED_ABANDON_MS} (7 days).
     */
    abandonAfterMs?: number;
    /**
     * Injectable age-out reaper (BI-A009313E). Given a stranded pre-build build
     * past the cap, transition it to `abandoned` and return whether it did.
     * Defaults to {@link abandonStrandedPreBuild}; injected in tests so the boot
     * reconcile can be asserted without a real DB write.
     */
    abandonStale?: (args: { buildId: string; phase: string; ageMs: number }) => Promise<boolean>;
  } = {},
  logger: Pick<Console, "log" | "error"> = console,
): Promise<{ resumed: number; flagged: number; advanced: number; abandoned: number } | null> {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return null;
  const staleAfterMs = opts.staleAfterMs ?? 5 * 60 * 1000;
  try {
    const { prisma } = await import("@dpf/db");
    const { classifyContradictoryExecState } = await import(
      "@/lib/build/build-exec-types"
    );
    type ExecStateLike = import("@/lib/build/build-exec-types").ExecStateLike;
    // Age-out cap primitives (BI-A009313E). Lazy-imported to keep the boot module
    // graph small, matching this file's convention.
    const { isStrandedPreBuildAbandonable, STRANDED_ABANDON_MS } = await import(
      "@/lib/build/resume-pre-build-phase"
    );
    const now = new Date();
    const cutoff = new Date(now.getTime() - staleAfterMs);
    const abandonAfterMs = opts.abandonAfterMs ?? STRANDED_ABANDON_MS;
    // BI-17377D05: cover ALL non-terminal pre-ship phases, not just `build`.
    // Only the `build` phase has a resumable step-machine (buildExecState) that
    // autoExecuteBuild can re-dispatch; ideate/plan/review are dispatch-driven
    // with no resume, so a swap (or a dead dispatch) used to strand them
    // SILENTLY. We still auto-resume `build`; for the pre-build phases we surface
    // the strand as recoverable so it stops being a silent orphan.
    const candidates = await prisma.featureBuild.findMany({
      where: {
        phase: { in: ["ideate", "plan", "build", "review"] },
        updatedAt: { lt: cutoff },
      },
      select: {
        buildId: true,
        phase: true,
        buildExecState: true,
        verificationOut: true,
        createdById: true,
        // createdAt + parentEpicId feed the age-out cap (BI-A009313E).
        createdAt: true,
        parentEpicId: true,
      },
    });

    // Default pre-build resumer (BI-9257CF19): lazy-imports the canonical
    // generator/reviewer re-fire and logs the outcome as a BuildActivity row.
    // Fire-and-forget so one slow re-review never blocks the boot reconcile.
    const resumePreBuild =
      opts.resumePreBuild ??
      ((args: { buildId: string; phase: string; userId: string }) => {
        void (async () => {
          const { resumePreBuildPhase } = await import("@/lib/build/resume-pre-build-phase");
          const outcome = await resumePreBuildPhase(args);
          await prisma.buildActivity
            .create({
              data: {
                buildId: args.buildId,
                tool: "resumeStrandedBuildsOnBoot",
                summary: `Pre-build resume (${args.phase}): ${outcome.kind}${
                  "via" in outcome ? ` via ${outcome.via} — ${outcome.detail}` : ""
                }${"reason" in outcome ? ` — ${outcome.reason}` : ""}${
                  "error" in outcome ? ` — ${outcome.error}` : ""
                }`,
              },
            })
            .catch(() => {});
        })().catch((err) =>
          logger.error(
            "[build-resume] pre-build resume failed for %s: %s",
            JSON.stringify(args.buildId),
            err instanceof Error ? JSON.stringify(err.message) : JSON.stringify(String(err)),
          ),
        );
      });

    // Default dispatcher lazy-imports the system executor to avoid pulling the
    // server-action module (and its auth wrappers) into the module graph until
    // a resume is actually needed.
    const dispatch =
      opts.dispatch ??
      ((buildId: string) => {
        void (async () => {
          const { autoExecuteBuild } = await import("@/lib/actions/build");
          await autoExecuteBuild(buildId);
        })().catch((err) =>
          logger.error(
            "[build-resume] re-dispatch failed for %s: %s",
            JSON.stringify(buildId),
            err instanceof Error ? JSON.stringify(err.message) : JSON.stringify(String(err)),
          ),
        );
      });

    // Default build->review advancer: the standalone helper that mirrors the
    // orchestrator's on-completion advance (scoped verification + phase gate).
    const advanceToReview = opts.advanceToReview ?? advanceStrandedBuildToReview;

    // Default age-out reaper (BI-A009313E): lazy-imports the canonical abandon
    // helper so a build stranded in a pre-build phase past the cap is retired to
    // `abandoned` rather than resumed forever.
    const abandonStale =
      opts.abandonStale ??
      (async (args: { buildId: string; phase: string; ageMs: number }) => {
        const { abandonStrandedPreBuild } = await import(
          "@/lib/build/resume-pre-build-phase"
        );
        return abandonStrandedPreBuild(args);
      });

    let resumed = 0;
    let flagged = 0;
    let advanced = 0;
    let abandoned = 0;
    for (const build of candidates) {
      // ── Pre-build phases (ideate/plan/review): no step-machine, but each
      // phase has a canonical generator/reviewer we can re-fire. BI-9257CF19:
      // auto-resume instead of merely flagging for operator rescue, so an
      // in-flight build survives a self-upgrade swap (the resume-after half of
      // the quiescence contract). Re-firing is safe here because the candidate
      // query already excludes anything updated within the staleness cutoff,
      // and each underlying dispatcher carries its own idempotency guard. Fire-
      // and-forget so one slow re-review never blocks the boot reconcile loop.
      if (build.phase !== "build") {
        // ── Age-out cap (BI-A009313E). A build created past the abandon
        // threshold while STILL in a pre-build phase has failed to progress for
        // a week — re-resuming it only re-churns the loop that a self-upgrade
        // swap re-triggers every time (the acute flood: 63 dead ideate strands
        // re-resumed on every swap). Retire it to `abandoned` so it leaves the
        // candidate set for good; quiescence's reconcileTerminalBuildPhaseRuns
        // then closes its open BuildPhaseRun. Keyed on createdAt, so this is
        // immune to the resume churn re-heartbeating the row (the exact reason
        // the quiescence dead-phase reaper can't clear these). Re-promote the
        // backlog item to retry — abandonment is reversible.
        if (
          isStrandedPreBuildAbandonable({
            phase: build.phase,
            createdAt: build.createdAt,
            parentEpicId: build.parentEpicId,
            now,
            thresholdMs: abandonAfterMs,
          })
        ) {
          const ageMs = now.getTime() - build.createdAt.getTime();
          const didAbandon = await abandonStale({
            buildId: build.buildId,
            phase: build.phase,
            ageMs,
          });
          if (didAbandon) {
            abandoned++;
            logger.log(
              `[build-resume] ${build.buildId} stranded in ${build.phase} for >${Math.round(
                ageMs / 86_400_000,
              )}d — aged out to abandoned instead of resuming (BI-A009313E)`,
            );
            continue;
          }
          // Abandon declined (raced to alive/terminal); fall through to resume.
        }

        logger.log(
          `[build-resume] ${build.buildId} stranded in ${build.phase} phase after restart/swap — auto-resuming (BI-9257CF19)`,
        );
        await prisma.buildActivity
          .create({
            data: {
              buildId: build.buildId,
              tool: "resumeStrandedBuildsOnBoot",
              summary: `Stranded in ${build.phase} phase after a restart/swap — auto-resuming the canonical ${build.phase} generator/reviewer (BI-9257CF19).`,
            },
          })
          .catch(() => {});
        resumePreBuild({ buildId: build.buildId, phase: build.phase, userId: build.createdById });
        flagged++;
        continue;
      }

      // ── Build phase: proven step-machine resume (unchanged behavior). ──
      const state = build.buildExecState as ExecStateLike | null;
      // Skip contradictory shapes — the contradictory-recovery reconciler owns
      // those. (This also excludes the `complete-no-verify` relic, so the
      // build->review branch below only sees a genuinely verified `complete`.)
      if (classifyContradictoryExecState(state, build.verificationOut) !== null) continue;
      const step = state?.step;

      // ── Build->review transition strand (this fix). A build whose tasks all
      // ran and whose verification populated (step=`complete`, non-contradictory)
      // but whose phase is still `build` was interrupted at the auto-advance
      // boundary: a self-upgrade swap (or an advance that fired before a gate fix
      // deployed) killed the orchestrator AFTER it persisted `complete` but
      // BEFORE it flipped phase->review. Nothing re-fires the advance, so the
      // build sits in `build` forever, quiet. Re-run the SAME advance the
      // orchestrator does on normal completion: recompute the SCOPED verification
      // and the `build->review` gate, and advance only if it passes. A
      // genuinely-broken build (in-scope failure) leaves the gate disallowed and
      // is left stranded — we never force-advance it. Observed live: FB-69231490
      // (3/3 tasks DONE, scoped typecheckPassed=true testsFailed=0, never
      // advanced for 35+ min).
      if (step === "complete") {
        try {
          const didAdvance = await advanceToReview(build.buildId);
          if (didAdvance) {
            logger.log(
              `[build-resume] ${build.buildId} stranded at build→review transition — advancing (gate passed)`,
            );
            await prisma.buildActivity
              .create({
                data: {
                  buildId: build.buildId,
                  tool: "resumeStrandedBuildsOnBoot",
                  summary:
                    "Stranded at the build→review transition after a restart/swap (tasks complete, scoped gate passes) — advancing to review.",
                },
              })
              .catch(() => {});
            advanced++;
          }
        } catch (advErr) {
          logger.error(
            "[build-resume] build→review advance failed for %s: %s",
            JSON.stringify(build.buildId),
            advErr instanceof Error ? JSON.stringify(advErr.message) : JSON.stringify(String(advErr)),
          );
        }
        continue;
      }

      // Terminal `failed` step — owned by the contradictory-recovery reconciler;
      // leave as-is.
      if (step === "failed") continue;

      // Null/absent exec-state in `build` phase (BI-B036209D): no working
      // step-machine (recovery cleared it "for clean restart", or a 0-task
      // orchestration then null). Previously skipped here AND uncovered by the
      // pre-build age-out above → silent forever-orphan blocking its dependents.
      // Re-dispatch to honor the clean-restart intent; age out past the cap so a
      // never-dispatchable build is reaped, not churned. `build`-phase strands are
      // NOT epic-coordinated, so the cap applies regardless of parentEpicId.
      if (step == null) {
        const ageMs = now.getTime() - build.createdAt.getTime();
        if (ageMs > abandonAfterMs) {
          const didAbandon = await abandonStale({
            buildId: build.buildId,
            phase: build.phase,
            ageMs,
          });
          if (didAbandon) {
            abandoned++;
            logger.log(
              `[build-resume] ${build.buildId} stranded in build phase with no exec-state for >${Math.round(
                ageMs / 86_400_000,
              )}d — aged out to abandoned instead of re-dispatching forever (BI-B036209D)`,
            );
            continue;
          }
          // Abandon declined (raced to alive/terminal) — fall through to re-dispatch.
        }
        logger.log(
          `[build-resume] ${build.buildId} stranded in build phase with no exec-state — re-dispatching for a clean restart (BI-B036209D)`,
        );
        await prisma.buildActivity
          .create({
            data: {
              buildId: build.buildId,
              tool: "resumeStrandedBuildsOnBoot",
              summary:
                "Stranded in build phase with no exec-state (cleared for restart / 0-task orchestration) — re-dispatching for a clean restart (BI-B036209D).",
            },
          })
          .catch(() => {});
        dispatch(build.buildId);
        resumed++;
        continue;
      }

      logger.log(
        `[build-resume] ${build.buildId} stranded at step=${step} (no progress since updatedAt) — re-dispatching pipeline`,
      );
      await prisma.buildActivity
        .create({
          data: {
            buildId: build.buildId,
            tool: "resumeStrandedBuildsOnBoot",
            summary: `Re-dispatched stranded build on boot (step=${step}); pipeline resumes from getResumeStep`,
          },
        })
        .catch(() => {});
      dispatch(build.buildId);
      resumed++;
    }
    if (resumed > 0) {
      logger.log(`[build-resume] re-dispatched ${resumed} stranded build(s)`);
    }
    if (flagged > 0) {
      logger.log(`[build-resume] auto-resumed ${flagged} pre-build-phase strand(s) (ideate/plan/review)`);
    }
    if (advanced > 0) {
      logger.log(`[build-resume] advanced ${advanced} build→review transition strand(s)`);
    }
    if (abandoned > 0) {
      logger.log(
        `[build-resume] aged out ${abandoned} stranded pre-build strand(s) to abandoned (created > ${Math.round(
          abandonAfterMs / 86_400_000,
        )}d ago, no progress) (BI-A009313E)`,
      );
    }
    return { resumed, flagged, advanced, abandoned };
  } catch (err) {
    logger.error("[build-resume] failed (non-fatal):", err);
    return null;
  }
}

/**
 * Next.js global error hook — fires for every unhandled server-side error.
 * Counts them into dpf_http_unhandled_errors_total{route,method} so the
 * UnhandledServerErrors alert can fire. The portal has no per-request HTTP
 * instrumentation, so this is the zero-route-change global error signal.
 * [BI-994B504C]
 */
export async function onRequestError(
  _error: unknown,
  request: { path?: string; method?: string },
  context: { routePath?: string },
): Promise<void> {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { httpUnhandledErrors } = await import("@/lib/metrics");
    const route = context?.routePath || request?.path || "unknown";
    const method = request?.method || "unknown";
    httpUnhandledErrors.labels(route, method).inc();
  } catch {
    /* never let metrics bookkeeping interfere with error reporting */
  }
}

export async function register() {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    // Fire the deprecation warning up front so operators see it on first
    // boot rather than waiting for a contribution to trip it.
    warnIfLegacyHiveTokenEnvSet();

    // Measurement-runtime boot (BI-232BA634): the UX route sweep measures a
    // frozen baseline against a live portal, so background boot writers are
    // the nondeterminism. Under this flag, render-relevant syncs are awaited
    // and operational self-heal maintenance is skipped entirely.
    const measurementRuntime = isMeasurementRuntime();
    if (measurementRuntime) {
      console.log(
        "[instrumentation] Measurement runtime: boot syncs awaited, background maintenance disabled (DPF_MEASUREMENT_RUNTIME)",
      );
    }

    // Plane-2 decision-routing gate (BI-B22DE548): register the server-side
    // governance hook so an in-portal coworker / Build Studio agent that takes a
    // consequential backlog decision (triage/retire) without consulting the
    // kernel (principle_decide) is gated. Registration is in-memory + idempotent
    // (deduped by hook id); mode is DPF_DECISION_GATE_MODE (enforce default).
    {
      const { registerServerToolGovernanceHooks } = await import(
        "@/lib/governance/register-tool-governance-hooks"
      );
      registerServerToolGovernanceHooks();
    }

    // Mirror version.json into PlatformConfig["platform.version"] so the
    // DB-backed runtime metadata matches the canonical file. Non-fatal —
    // logs loudly on failure but does not block startup (awaited under
    // measurement runtime so routes render one consistent version).
    await settleBootSync(measurementRuntime, syncPlatformVersionOnBoot);

    // DB-continuity guard (BI-B61779DB): detect a reverted/stale postgres volume
    // BEFORE any reconciler trusts the data. A monotonic epoch lives in BOTH the
    // DB (reverts with the data) and a host-side marker outside the volume (does
    // not). If the DB came up behind the host marker, the volume was swapped or
    // reverted — the 2026-06-23 8-day silent revert. Awaited so the opt-in
    // fail-closed (DPF_DB_REVERT_FAILCLOSED=1) can abort boot; otherwise it records
    // a durable PlatformConfig alert + a CRITICAL log and proceeds. Non-fatal on
    // any other error (the wrapper swallows them) so a guard bug can't wedge boot.
    {
      const { assertDbContinuityOnBoot } = await import("@/lib/operate/db-continuity");
      await assertDbContinuityOnBoot();
    }

    // Runtime capability recovery is a boot barrier, not background cleanup:
    // no authenticated mutation may be admitted until durable host/DB state is
    // reconciled or explicitly marked recovery_required.
    {
      const { createProductionRuntimeTransitionHost, reconcileRuntimeCapabilityTransitionsOnStartup } = await import("@/lib/platform-runtime/transition-recovery");
      try {
        await reconcileRuntimeCapabilityTransitionsOnStartup(await createProductionRuntimeTransitionHost());
      } catch (error) {
        console.error("[runtime-capabilities] Startup reconciliation requires recovery:", error);
      }
    }

    // Graph-mirror projections with no indexer of their own (BI-FEDFABF6). Boot is
    // the trigger because it follows migrations, self-upgrade and first start of a
    // new install. Skipped under measurement runtime like the self-heal block below;
    // refreshGraphProjections never throws and logs its own failures.
    if (!measurementRuntime) {
      void import("@/lib/graph/refresh-projections").then((m) => m.refreshGraphProjections());
    }

    // Operational self-heal maintenance (voice continuity, stuck-run
    // reconciles, watchdog intervals, model-context re-assertion). Skipped
    // wholesale under measurement runtime: an ephemeral sweep portal has no
    // stuck state to heal, and these fire-and-forget writers racing the crawl
    // are exactly the same-tree pass/fail nondeterminism BI-232BA634 removed.
    if (!measurementRuntime) {
      // Voice-service desired-state fail-loud (BI-264565A4): if narration is
      // enabled but the TTS sidecar is down, log CRITICAL at boot — Prometheus
      // can't scrape a /health-only sidecar, and this beats the VoiceServiceDown
      // alert's scrape+2m delay. Non-fatal; detection only (self-heal is a
      // separate follow-up).
      void (async () => {
        const { assertVoiceServiceOnBoot } = await import(
          "@/lib/operate/voice-service-continuity"
        );
        await assertVoiceServiceOnBoot();
      })();

      // Self-heal a quiescence level left stuck by a swap that killed the
      // coordinator mid-protocol — otherwise the portal refuses gated requests
      // ("portal_quiescing") forever. Must run before reconciliation.
      void resetStuckQuiescenceLevelOnBoot();

      void reconcileSelfUpgradeAdmissions().catch((error) => console.error("[self-upgrade] admission reconcile failed", error));
      void reconcileSelfUpgradeRunsOnBoot(); void import("@/lib/federation/boot-reconcile").then((m) => m.reconcileFederationDurableStateOnBoot()).catch((error) => console.error("[federation] durable-state reconcile failed", error));

      // Periodic safety net — cron-independent (the boot reconcile above and the
      // Inngest cron can BOTH miss this). If a swap's orchestrator dies while the
      // portal stays UP (no reboot), the SelfUpgradeRun sits "running" forever and
      // every future trigger silently no-ops (requestPortalSelfUpgradeAction). The
      // June-10 run sat "running" for 4 days until a manual restart — this re-runs
      // the reconcile in-process so a stuck run self-heals within ~20 min instead.
      // Staleness-guarded so a legitimately in-flight upgrade is never touched.
      setInterval(
        () => {
          void reconcileSelfUpgradeAdmissions().catch((error) => console.error("[self-upgrade] admission reconcile failed", error));
          void reconcileSelfUpgradeRunsOnBoot(console, { staleAfterMs: 30 * 60 * 1000 });
          // Backstop: force-remove any promoter container orphaned by a portal
          // restart that killed runPromoter's own timeout timer (BI-3EC7FDB0).
          void sweepOrphanedPromoterContainers({ maxAgeMs: 30 * 60 * 1000 });
        },
        20 * 60 * 1000,
      );

      // Close the SAME self-swap gap for the quiescence coordinator. A succeeded
      // upgrade whose swap kills the orchestrator leaves the coordinator to time
      // out and falsely emit `failed`, surfacing as a bogus "Upgrade postponed,
      // failed" banner. The surviving portal completes the swap-complete handshake
      // here (boot), plus a periodic net for the portal-stays-up orphan case.
      void reconcileQuiescenceRunsOnBoot();
      setInterval(
        () => {
          void reconcileQuiescenceRunsOnBoot(console, { staleAfterMs: 30 * 60 * 1000 });
        },
        20 * 60 * 1000,
      );

      // Same boot + periodic safety net for BackupRun rows stuck "running": a
      // backup runner that dies mid-dump leaves a false "in progress" row forever
      // (no other recovery), polluting the backup-health card + corruption alerts.
      void (async () => {
        const { reconcileStuckBackupRuns } = await import(
          "@/lib/operate/backups/reconcile-stuck-runs"
        );
        await reconcileStuckBackupRuns();
        setInterval(() => void reconcileStuckBackupRuns(), 20 * 60 * 1000);
      })();

      // Self-heal the local model's served context window. A Docker Desktop / DMR
      // restart wipes DMR's per-model `context-size` override back to the model
      // card default (qwen3-coder = 4k), which silently overflows EVERY local
      // coworker turn (exceed_context_size_error: request ~24k > n_ctx 4096). The
      // first-run bootstrap raises it once; this re-asserts it on every boot (the
      // common case: a Docker restart restarts the portal too) plus a periodic net
      // (a DMR-only restart while the portal stays up). Idempotent + best-effort.
      void (async () => {
        const { reconcileLocalModelContext } = await import(
          "@/lib/inference/local-model-context-reconcile"
        );
        const logCtx = (r: Awaited<ReturnType<typeof reconcileLocalModelContext>>) => {
          if (r.status === "raised") {
            console.log(
              `[local-model-context] raised ${r.modelId} ${r.before ?? "unset"} → ${r.after} tokens`,
            );
          } else if (r.status === "deferred") {
            console.warn(
              `[local-model-context] raise deferred (${r.reason ?? "unknown"}); applies on next model load`,
            );
          }
        };
        logCtx(await reconcileLocalModelContext());
        setInterval(() => void reconcileLocalModelContext().then(logCtx), 20 * 60 * 1000);
        // Same boot + periodic net for the provider ↔ default-connection status
        // split (BI-04E4F111): routing filters on AiProviderConnection.status
        // while the UI renders ModelProvider.status — see the module header.
        const { reconcileProviderConnectionState } = await import(
          "@/lib/inference/provider-connection-reconcile"
        );
        await reconcileProviderConnectionState().catch(() => {});
        setInterval(() => void reconcileProviderConnectionState().catch(() => {}), 20 * 60 * 1000);
      })();
    }

    // Backfill the operational value stream (OVSM) EA view for any storefront
    // that completed setup before the #1798 generator was running on it — those
    // installs have a StorefrontConfig + archetype but no archetype_value_stream
    // EaView, so /ea/value-streams shows the empty state forever with nothing to
    // self-heal it. Cheap when already present (existence check, no projection);
    // idempotent and non-fatal per org. Awaited under measurement runtime so
    // every measured route observes the same post-backfill state.
    await settleBootSync(measurementRuntime, async () => {
      const { backfillOperationalValueStreamsOnBoot } = await import(
        "@/lib/storefront/backfill-operational-value-streams"
      );
      await backfillOperationalValueStreamsOnBoot();
    });

    // Backfill the org WWWD corpus (BI-44526F3E Phase A) for any install that
    // completed setup before the onboarding seed chain existed — those orgs
    // have no overlay wiki pages and no org DecisionPerspectiveProfile, so the
    // Decision Governance hub shows "no stance of your own yet" forever and
    // business decisions silently fall back to platform doctrine. Cheap when
    // already present (existence checks only); idempotent and non-fatal per org.
    // Awaited under measurement runtime: this backfill flips empty-state prose
    // on governance/workspace surfaces, so racing it is measurable word drift.
    await settleBootSync(measurementRuntime, async () => {
      const { backfillOrgWwwdOnBoot } = await import(
        "@/lib/onboarding/backfill-org-wwwd-on-boot"
      );
      await backfillOrgWwwdOnBoot();
    });

    // The active archetype's worker classes + work locations, for an install that
    // completed setup before the archetype declared them (BI-A30152B6). The WWWD
    // backfill above runs the same chain only when a corpus is MISSING, so a
    // healthy install short-circuits it and nothing else self-heals the rows.
    void import("@/lib/onboarding/seed-archetype-workforce").then(({ backfillArchetypeWorkforceOnBoot }) => backfillArchetypeWorkforceOnBoot());
    void import("@/lib/onboarding/backfill-commercial-catalog-on-boot").then(({ backfillCommercialCatalogOnBoot }) => backfillCommercialCatalogOnBoot());

    // Discovery estate self-heal (BI-BAF38ED3 attribution + BI-B19C41B8 phantom
    // products) — idempotent, cheap once healed, non-fatal, fire-and-forget.
    void import("@/lib/onboarding/discovery-on-boot-self-heal").then(
      ({ runDiscoveryOnBootSelfHeal }) => runDiscoveryOnBootSelfHeal(),
    );
    // Build Studio engine reliability (spec §3.1 engine-first / FB-78E967D4).
    // These are correctness reconcilers, not optional maintenance — skipped
    // only under measurement runtime (an ephemeral sweep portal runs no
    // builds, and their FeatureBuild writes race the crawl) — and FIX 1 runs
    // before FIX 2 so contradictory checkpoints are coerced/cleared before
    // the resume pass considers them.
    //
    // FIX 1: auto-recover builds whose buildExecState landed in a contradictory
    // shape (was previously only escapable via the manual "Reset Build").
    // FIX 2: re-dispatch builds whose fire-and-forget pipeline was killed by a
    // portal recycle, leaving a row stranded mid-step that nothing resumes.
    if (!measurementRuntime) {
      void (async () => {
        await recoverContradictoryBuildExecStatesOnBoot();
        await resumeStrandedBuildsOnBoot();
        // Complete any ship-phase builds whose merged code went live in the
        // self-upgrade that just (re)started this portal (autonomous-completion
        // path; no-op when the flag is off).
        await reconcileDeployedShipBuilds();
      })();

      // Periodic build-resume (cron-independent) — the boot reconcile above runs
      // ONLY once at startup, so any build CREATED or STRANDED after boot (e.g. a
      // decomposition's child builds, a fresh promote, or a phase that strands
      // mid-pipeline) sits untouched until the next reboot. Observed live: the 3
      // children from a decomposition stuck at zero phases 19+ min post-restart,
      // because resumeStrandedBuildsOnBoot had already run before they existed.
      // Re-run the SAME reconcilers on an interval so the drain is CONTINUOUS, not
      // boot-only — mirroring the self-upgrade-reconcile and stale-slot-reclaim
      // periodic safety nets above. Both reconcilers are idempotent; the resume
      // uses a LONGER staleness (20 min) than the boot default (5 min) so a
      // legitimately slow in-flight phase (an ideate dispatch can run ~14 min) is
      // never re-dispatched out from under itself.
      setInterval(
        () => {
          void (async () => {
            await recoverContradictoryBuildExecStatesOnBoot();
            await resumeStrandedBuildsOnBoot({ staleAfterMs: 20 * 60 * 1000 });
            await reconcileDeployedShipBuilds();
          })();
        },
        10 * 60 * 1000,
      );
    }

    const optionalStartupTasksEnabled = areOptionalStartupTasksEnabled();
    if (!optionalStartupTasksEnabled) {
      console.log("[instrumentation] Optional startup maintenance skipped (disabled)");
    }

    // Register ScheduledJob rows so the calendar shows discovery events.
    // Actual execution handled by Inngest cron functions (lib/queue/functions/).
    if (optionalStartupTasksEnabled) {
      const { registerScheduledJobs } = await import("@/lib/operate/discovery-scheduler");
      registerScheduledJobs().catch((err) =>
        console.error("[instrumentation] Failed to register discovery jobs:", err),
      );
      scheduleInitialCodeGraphBootstrap();
    }

    // Self-sync our function catalog with the Inngest server.
    // In self-hosted mode (INNGEST_DEV=0) the Inngest server does NOT auto-
    // discover apps — events are silently acked with no dispatch target,
    // which manifests as UI flows stuck in "Working on it..." forever.
    // Hitting our own PUT /api/inngest triggers the serve() handler to
    // register/refresh the app with the Inngest server. Runs after a small
    // delay to give Next.js time to bind the HTTP listener.
    if (process.env.INNGEST_BASE_URL && isInngestSelfSyncOnBootEnabled()) {
      const endpoint = resolveInngestSelfRegistrationEndpoint(process.env);
      setTimeout(async () => {
        let lastErr: unknown = null;
        for (let i = 0; i < 6; i++) {
          const { recordInngestRegistration } = await import("@/lib/queue/job-engine-health");
          const result = await syncInngestSelfRegistration({
            endpoint,
            fetchRegistration: fetch,
            recordRegistration: recordInngestRegistration,
            reconcileAdmissions: reconcileSelfUpgradeAdmissions,
          });
          if (result.ok) {
            console.log(`[inngest-sync] Registered with Inngest server: HTTP ${result.data.status}`);
            if (result.data.reconciliationError) {
              console.error(`[self-upgrade] admission reconcile failed: ${result.data.reconciliationError}`);
            }
            return;
          }
          lastErr = result.error;
          await new Promise((r) => setTimeout(r, 2_000));
        }
        console.error(
          `[inngest-sync] Failed to register with Inngest server after 6 attempts: ${String(lastErr)}. ` +
          `Background jobs (brand extract, evals, etc.) will not dispatch until this succeeds.`,
        );
      }, 3_000);
    } else if (process.env.INNGEST_BASE_URL) {
      console.log("[inngest-sync] Boot self-registration skipped (disabled)");
    }

    // Periodic re-sync (in-process, cron-independent): re-register every 5 min so
    // the job engine self-heals WITHOUT a portal reboot if the boot sync failed
    // or Inngest later restarts and forgets its registration (the 2026-06-14
    // outage needed a reboot to re-register). Also keeps ops.jobEngine fresh.
    if (process.env.INNGEST_BASE_URL && isInngestSelfSyncOnBootEnabled()) {
      const endpoint = resolveInngestSelfRegistrationEndpoint(process.env);
      setInterval(
        () => {
          void (async () => {
            const { recordInngestRegistration, runInngestExecutorWatchdog } = await import(
              "@/lib/queue/job-engine-health"
            );
            const result = await syncInngestSelfRegistration({
              endpoint,
              fetchRegistration: fetch,
              recordRegistration: recordInngestRegistration,
              reconcileAdmissions: reconcileSelfUpgradeAdmissions,
            });
            if (result.ok && result.data.reconciliationError) {
              console.error(`[self-upgrade] admission reconcile failed: ${result.data.reconciliationError}`);
            }
            void runInngestExecutorWatchdog().then((r) => r.status === "degraded" && console.warn(`[inngest-watchdog] ${r.detail ?? "executor degraded"}`));
          })();
        },
        5 * 60 * 1000,
      );
    }

    // ── Pin audit invariant ────────────────────────────────────────────────
    // Principle: routing must pick the right LLM dynamically from capability
    // tier + task type — no hard pins (see feedback_no_provider_pinning).
    // Pin rows are not removed on read, so a stray one from a legacy seed
    // or manual admin change would silently override routing for that agent.
    // Surface any surviving pins loudly so they get noticed and cleared.
    if (optionalStartupTasksEnabled) {
      setTimeout(async () => {
        try {
          const { prisma } = await import("@dpf/db");
          const pinnedAgents = await prisma.agentModelConfig.findMany({
            where: {
              OR: [
                { pinnedProviderId: { not: null } },
                { pinnedModelId: { not: null } },
              ],
            },
            select: {
              agentId: true,
              pinnedProviderId: true,
              pinnedModelId: true,
            },
          });
          if (pinnedAgents.length > 0) {
            console.warn(
              `[pin-audit] ${pinnedAgents.length} AgentModelConfig row(s) carry a pin. Routing should be tier-based; pins override it. Clear them or document why: ` +
                pinnedAgents
                  .map(
                    (a) =>
                      `${a.agentId}=${a.pinnedProviderId ?? "?"}/${a.pinnedModelId ?? "?"}`,
                  )
                  .join(", "),
            );
          }
        } catch (err) {
          // Non-fatal; guard is advisory.
          console.warn("[pin-audit] check failed:", err);
        }
      }, 20_000);
    }

    // ── First-boot auto-provisioning ───────────────────────────────────────
    // Runs 15s after startup and reconciles both pristine and interrupted
    // provider setup. ModelProfile is the routing source: seed priors keep it
    // usable immediately, then the durable eval queue replaces those priors
    // with measured dimensions. Existing seed profiles must be retried too,
    // or one unavailable queue startup can strand calibration indefinitely.
    if (optionalStartupTasksEnabled) {
      setTimeout(async () => {
        try {
          const { prisma } = await import("@dpf/db");
          const { canRunStartupModelDiscovery } = await import(
            "@/lib/routing/provider-eligibility"
          );
          const activeProviders = await prisma.modelProvider.findMany({
            where: { status: { in: ["active", "degraded"] } },
            select: {
              providerId: true,
              endpointType: true,
              category: true,
              serviceKind: true,
              authMethod: true,
              cliEngine: true,
            },
          });

          for (const provider of activeProviders.filter(canRunStartupModelDiscovery)) {
            const { providerId } = provider;
            const { reconcileFirstBootProvider } = await import(
              "@/lib/routing/first-boot-provider-reconciliation"
            );
            const { autoDiscoverAndProfile, queueUncalibratedModelEvals } = await import(
              "@/lib/inference/ai-provider-internals"
            );
            const result = await reconcileFirstBootProvider({
              countProfiles: () => prisma.modelProfile.count({ where: { providerId } }),
              discoverAndProfile: () => autoDiscoverAndProfile(providerId),
              queueUncalibratedEvals: () => queueUncalibratedModelEvals(providerId),
            });
            console.log(
              `[first-boot] ${providerId}: discovered=${result.discovered}, profiled=${result.profiled}, queued=${result.queued}${result.discoveryError ? ` (${result.discoveryError})` : ""}`,
            );
          }
        } catch (err) {
          console.warn("[first-boot] Auto-provisioning failed (non-fatal):", err);
        }
      }, 15_000);
    }

    if (isStartupModelRevalidationEnabled()) {
      // ── Periodic revalidation ────────────────────────────────────────────
      // EP-MODEL-CAP-001-D: Startup revalidation — runs 90–120s after startup.
      // Jitter avoids thundering-herd when multiple replicas start simultaneously.
      // This handles ongoing model status changes (new models, deprecated models)
      // for providers that already have profiles.
      const STARTUP_DELAY_MS = 90_000 + Math.floor(Math.random() * 30_000);
      const { Pool } = await import("pg");
      const pgPool = new Pool({ connectionString: process.env.DATABASE_URL });
      setTimeout(async () => {
        try {
          const { runModelRevalidation } = await import(
            "@/lib/inference/model-revalidation"
          );
          await runModelRevalidation({ source: "startup" }, pgPool);
        } catch (err) {
          console.warn(
            "[model-revalidation] Startup revalidation failed (non-fatal):",
            err,
          );
        } finally {
          await pgPool.end().catch(() => {});
        }
      }, STARTUP_DELAY_MS);
    } else {
      console.log("[model-revalidation] Startup revalidation skipped (disabled)");
    }

    // ── Sandbox slot pool initialization ──────────────────────────────────
    // Resets all SandboxSlot rows to "available" on every boot.
    // Handles stale slots from portal crashes without manual intervention:
    // if the portal dies mid-pipeline the new instance immediately frees any
    // held slots so queued builds don't wait indefinitely.
    if (optionalStartupTasksEnabled) {
      setTimeout(async () => {
        try {
          const { initializePool } = await import(
            "@/lib/build/sandbox/sandbox-pool"
          );
          await initializePool();
          console.log(
            "[sandbox-pool] Slot pool initialized (all slots reset to available)",
          );
        } catch (err) {
          console.error("[sandbox-pool] Failed to initialize slot pool:", err);
        }

        // Belt-and-suspenders stale-slot reclaim: runs 30 s after boot then
        // every 30 min. Targets slots held by builds that are no longer in the
        // 'build' phase OR that have a terminal buildExecState (complete/failed)
        // despite being in 'build' phase — catches the rare case where the
        // pipeline finished without releasing the slot.
        async function reclaimStaleSandboxSlots() {
          try {
            const { prisma } = await import("@dpf/db");
            const staleSlots = await prisma.sandboxSlot.findMany({
              where: {
                status: "in_use",
                buildId: { not: null },
                acquiredAt: { lt: new Date(Date.now() - 120 * 60 * 1000) }, // > 2 h old
              },
            });

            for (const slot of staleSlots) {
              if (!slot.buildId) continue;
              const build = await prisma.featureBuild.findUnique({
                where: { buildId: slot.buildId },
                select: { phase: true, buildExecState: true },
              });
              const execState = build?.buildExecState as { step?: string } | null;
              const execTerminal =
                execState?.step === "complete" || execState?.step === "failed";
              const phaseLeft = !build || build.phase !== "build";

              if (phaseLeft || execTerminal) {
                await prisma.sandboxSlot.update({
                  where: { id: slot.id },
                  data: {
                    status: "available",
                    buildId: null,
                    userId: null,
                    releasedAt: new Date(),
                  },
                });
                console.log(
                  `[sandbox-pool] Reclaimed stale slot ${slot.slotIndex} from ${slot.buildId}` +
                    ` (phase=${build?.phase ?? "not found"}, execStep=${execState?.step ?? "null"})`,
                );
              }
            }
          } catch (err) {
            console.warn(
              "[sandbox-pool] Stale slot reclaim failed (non-fatal):",
              err,
            );
          }
        }

        await reclaimStaleSandboxSlots();
        setInterval(reclaimStaleSandboxSlots, 30 * 60 * 1000);
      }, 5_000);
    }

    // ── CREDENTIAL_ENCRYPTION_KEY fail-loud guard ──────────────────────────
    // Refuses to boot in production when the credential store contains
    // secrets but the encryption key is unset — that combination would cause
    // silent plaintext storage (data-at-rest vulnerability).
    // Dev mode short-circuits immediately; zero overhead outside production.
    // See docs/superpowers/specs/2026-04-24-github-auth-2fa-readiness-design.md
    // Serve the directory (EP-24741BBF · BI-A91004A7) — off unless DPF_LDAP_ENABLED.
    await (await import("@/lib/directory/ldap/runtime")).startLdapListener();

    // Wiki embedding coverage self-heal — deferred, non-blocking (BI-ED117C82).
    const { scheduleWikiEmbeddingReconcile } = await import("@/lib/wiki/embedding-reconciliation");
    scheduleWikiEmbeddingReconcile();

    const { assertCredentialEncryptionKeyIsSet } = await import("@/lib/govern/credential-crypto");
    await assertCredentialEncryptionKeyIsSet();
  }
}
