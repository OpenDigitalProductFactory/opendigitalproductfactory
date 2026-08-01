// Node startup instrumentation helpers. Kept outside the Next instrumentation entrypoint so the entrypoint stays small and Edge-safe.

import { envFlagEnabled } from "@/lib/runtime/env-flags";

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

export function isStartupModelRevalidationEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return envFlagEnabled(env, "DPF_STARTUP_MODEL_REVALIDATION_ENABLED");
}

export function isInngestSelfSyncOnBootEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return envFlagEnabled(env, "DPF_INNGEST_SELF_SYNC_ON_BOOT_ENABLED");
}

export function areOptionalStartupTasksEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return envFlagEnabled(env, "DPF_OPTIONAL_STARTUP_TASKS_ENABLED");
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
          const { ensureCodeGraphInitialized } = await import("@/lib/integrate/code-graph-refresh");
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
 * Enqueue background dimension evals for every active ModelProfile under the
 * given provider. Sends one `ai/eval.run` event per model so Inngest dispatches
 * them with the function's own concurrency cap (limit 2) and retry policy.
 * Errors are swallowed because this runs in startup context — the operator
 * can re-trigger via Run Probes if anything fails. Exported for testing.
 *
 * BI-INST-001: this is the missing step in the first-boot auto-provisioning
 * chain. Without it, ModelProfile rows existed but EndpointTaskPerformance
 * was empty, so the router rejected every LLM task with "No eligible
 * endpoints found."
 */
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
