// Next.js instrumentation hook — runs once on server startup.
// See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

import { isMeasurementRuntime, settleBootSync } from "@/lib/runtime/measurement-runtime";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import {
  areOptionalStartupTasksEnabled,
  isInngestSelfSyncOnBootEnabled,
  isStartupModelRevalidationEnabled,
  reconcileQuiescenceRunsOnBoot,
  reconcileSelfUpgradeRunsOnBoot,
  resetStuckQuiescenceLevelOnBoot,
  scheduleInitialCodeGraphBootstrap,
  syncPlatformVersionOnBoot,
  warnIfLegacyHiveTokenEnvSet,
} from "@/lib/instrumentation/startup-tasks";
import {
  recoverContradictoryBuildExecStatesOnBoot,
  reconcileDeployedShipBuilds,
  resumeStrandedBuildsOnBoot,
} from "@/lib/instrumentation/build-recovery";
import { enqueueFirstBootEvals } from "@/lib/instrumentation/model-evals";
import { sweepOrphanedPromoterContainers } from "@/lib/self-upgrade/promoter-sweep";

export {
  areOptionalStartupTasksEnabled,
  isInngestSelfSyncOnBootEnabled,
  isStartupModelRevalidationEnabled,
  reconcileQuiescenceRunsOnBoot,
  reconcileSelfUpgradeRunsOnBoot,
  resetStuckQuiescenceLevelOnBoot,
  scheduleInitialCodeGraphBootstrap,
  syncPlatformVersionOnBoot,
  warnIfLegacyHiveTokenEnvSet,
} from "@/lib/instrumentation/startup-tasks";
export {
  advanceStrandedBuildToReview,
  recoverContradictoryBuildExecStatesOnBoot,
  reconcileDeployedShipBuilds,
  resumeStrandedBuildsOnBoot,
} from "@/lib/instrumentation/build-recovery";
export { enqueueFirstBootEvals } from "@/lib/instrumentation/model-evals";

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

export async function registerNodeInstrumentation() {
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

      // Close the loop on any self-upgrade run whose orchestrator died mid-swap
      // (a real upgrade recreates this very container). Records succeeded when we
      // came up on the target SHA; fails orphans so triggers aren't blocked.
      void reconcileSelfUpgradeRunsOnBoot();

      // Periodic safety net — cron-independent (the boot reconcile above and the
      // Inngest cron can BOTH miss this). If a swap's orchestrator dies while the
      // portal stays UP (no reboot), the SelfUpgradeRun sits "running" forever and
      // every future trigger silently no-ops (requestPortalSelfUpgradeAction). The
      // June-10 run sat "running" for 4 days until a manual restart — this re-runs
      // the reconcile in-process so a stuck run self-heals within ~20 min instead.
      // Staleness-guarded so a legitimately in-flight upgrade is never touched.
      setInterval(
        () => {
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

    void import("@/lib/onboarding/backfill-commercial-catalog-on-boot").then(({ backfillCommercialCatalogOnBoot }) => backfillCommercialCatalogOnBoot());
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
      const appUrl = process.env.APP_URL ?? "http://localhost:3000";
      setTimeout(async () => {
        let lastErr: unknown = null;
        for (let i = 0; i < 6; i++) {
          try {
            const res = await fetch(`${appUrl}/api/inngest`, { method: "PUT" });
            if (res.ok) {
              const body = await res.json().catch(() => ({}));
              console.log(`[inngest-sync] Registered with Inngest server: ${JSON.stringify(body)}`);
              const { recordInngestRegistration } = await import(
                "@/lib/queue/job-engine-health"
              );
              await recordInngestRegistration(true);
              return;
            }
            lastErr = `HTTP ${res.status}`;
          } catch (err) {
            lastErr = getErrorMessage(err);
          }
          await new Promise((r) => setTimeout(r, 2_000));
        }
        console.error(
          `[inngest-sync] Failed to register with Inngest server after 6 attempts: ${String(lastErr)}. ` +
          `Background jobs (brand extract, evals, etc.) will not dispatch until this succeeds.`,
        );
        // Persist the failure so the ops UI surfaces a dead job engine — the
        // missing signal that let the 2026-06-14 outage hide for 4 days.
        const { recordInngestRegistration } = await import(
          "@/lib/queue/job-engine-health"
        );
        await recordInngestRegistration(
          false,
          `Inngest registration failed after 6 attempts: ${String(lastErr)}`,
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
      const appUrl = process.env.APP_URL ?? "http://localhost:3000";
      setInterval(
        () => {
          void (async () => {
            const { recordInngestRegistration, runInngestExecutorWatchdog } = await import(
              "@/lib/queue/job-engine-health"
            );
            try {
              const res = await fetch(`${appUrl}/api/inngest`, { method: "PUT" });
              await recordInngestRegistration(
                res.ok,
                res.ok ? null : `Inngest re-sync failed: HTTP ${res.status}`,
              );
            } catch (err) {
              await recordInngestRegistration(
                false,
                `Inngest re-sync failed: ${getErrorMessage(err)}`,
              );
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
    // Runs 15s after startup. Detects active providers with zero model
    // profiles (the exact state after a fresh install where the seed +
    // post-init SQL activated providers but no discovery has run yet).
    // This keeps provider catalog/model readiness as background maintenance
    // instead of asking operators to run catalog or eval chores by hand.
    //
    // BI-INST-001 (2026-05-23): the original first-boot hook stopped after
    // discoverModels + profileModels. ModelProfile rows existed but the
    // router still failed every LLM task with "No active endpoint manifests
    // found" because no probes had populated EndpointTaskPerformance. This
    // hook now enqueues `ai/eval.run` events for each freshly-profiled
    // model so dimension evals run in the background via Inngest. The
    // evals' new circuit breaker (BI-INST-008, eval-runner.ts
    // errorLooksLikeInfrastructure) keeps a single transient failure from
    // poisoning every model.
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
            const profileCount = await prisma.modelProfile.count({
              where: { providerId },
            });
            if (profileCount === 0) {
              console.log(
                `[first-boot] Provider "${providerId}" is active but has 0 model profiles — running auto-discovery...`,
              );
              const { autoDiscoverAndProfile } = await import(
                "@/lib/inference/ai-provider-internals"
              );
              const result = await autoDiscoverAndProfile(providerId);
              console.log(
                `[first-boot] ${providerId}: discovered=${result.discovered}, profiled=${result.profiled}${result.error ? ` (${result.error})` : ""}`,
              );

              // BI-INST-001 — enqueue background dimension evals for each
              // freshly profiled model. Without this step the router stays
              // empty of EndpointTaskPerformance rows and every LLM task
              // throws "No eligible endpoints" until the operator manually
              // clicks Run Probes. Inngest enforces concurrency=2 on
              // ai/eval.run so this doesn't swamp local model runners.
              if (result.profiled > 0) {
                await enqueueFirstBootEvals(providerId);
              }
            }
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
            "@/lib/integrate/sandbox/sandbox-pool"
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
    const { assertCredentialEncryptionKeyIsSet } = await import("@/lib/govern/credential-crypto");
    await assertCredentialEncryptionKeyIsSet();
  }
}
