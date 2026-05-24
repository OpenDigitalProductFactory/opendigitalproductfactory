// Next.js instrumentation hook — runs once on server startup.
// See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

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

export async function enqueueFirstBootEvals(providerId: string): Promise<{
  enqueued: number;
  error: string | null;
}> {
  try {
    const { prisma } = await import("@dpf/db");
    const profiles = await prisma.modelProfile.findMany({
      where: {
        providerId,
        modelStatus: "active",
        retiredAt: null,
      },
      select: { modelId: true },
    });
    if (profiles.length === 0) return { enqueued: 0, error: null };

    const { inngest } = await import("@/lib/queue/inngest-client");
    await inngest.send(
      profiles.map((p) => ({
        name: "ai/eval.run",
        data: {
          endpointId: providerId,
          modelId: p.modelId,
          userId: "first-boot",
        },
      })),
    );
    console.log(
      `[first-boot] Enqueued ${profiles.length} dimension eval(s) for ${providerId} (background via Inngest)`,
    );
    return { enqueued: profiles.length, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[first-boot] Failed to enqueue evals for ${providerId}: ${msg}`);
    return { enqueued: 0, error: msg };
  }
}

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    // Fire the deprecation warning up front so operators see it on first
    // boot rather than waiting for a contribution to trip it.
    warnIfLegacyHiveTokenEnvSet();

    // Mirror version.json into PlatformConfig["platform.version"] so the
    // DB-backed runtime metadata matches the canonical file. Non-fatal —
    // logs loudly on failure but does not block startup.
    void syncPlatformVersionOnBoot();

    // Register ScheduledJob rows so the calendar shows discovery events.
    // Actual execution handled by Inngest cron functions (lib/queue/functions/).
    const { registerScheduledJobs } = await import("@/lib/operate/discovery-scheduler");
    registerScheduledJobs().catch((err) =>
      console.error("[instrumentation] Failed to register discovery jobs:", err),
    );

    // Self-sync our function catalog with the Inngest server.
    // In self-hosted mode (INNGEST_DEV=0) the Inngest server does NOT auto-
    // discover apps — events are silently acked with no dispatch target,
    // which manifests as UI flows stuck in "Working on it..." forever.
    // Hitting our own PUT /api/inngest triggers the serve() handler to
    // register/refresh the app with the Inngest server. Runs after a small
    // delay to give Next.js time to bind the HTTP listener.
    if (process.env.INNGEST_BASE_URL) {
      const appUrl = process.env.APP_URL ?? "http://localhost:3000";
      setTimeout(async () => {
        let lastErr: unknown = null;
        for (let i = 0; i < 6; i++) {
          try {
            const res = await fetch(`${appUrl}/api/inngest`, { method: "PUT" });
            if (res.ok) {
              const body = await res.json().catch(() => ({}));
              console.log(`[inngest-sync] Registered with Inngest server: ${JSON.stringify(body)}`);
              return;
            }
            lastErr = `HTTP ${res.status}`;
          } catch (err) {
            lastErr = err instanceof Error ? err.message : String(err);
          }
          await new Promise((r) => setTimeout(r, 2_000));
        }
        console.error(
          `[inngest-sync] Failed to register with Inngest server after 6 attempts: ${String(lastErr)}. ` +
          `Background jobs (brand extract, evals, etc.) will not dispatch until this succeeds.`,
        );
      }, 3_000);
    }

    // ── Pin audit invariant ────────────────────────────────────────────────
    // Principle: routing must pick the right LLM dynamically from capability
    // tier + task type — no hard pins (see feedback_no_provider_pinning).
    // Pin rows are not removed on read, so a stray one from a legacy seed
    // or manual admin change would silently override routing for that agent.
    // Surface any surviving pins loudly so they get noticed and cleared.
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
          select: { agentId: true, pinnedProviderId: true, pinnedModelId: true },
        });
        if (pinnedAgents.length > 0) {
          console.warn(
            `[pin-audit] ${pinnedAgents.length} AgentModelConfig row(s) carry a pin. Routing should be tier-based; pins override it. Clear them or document why: ` +
              pinnedAgents
                .map((a) => `${a.agentId}=${a.pinnedProviderId ?? "?"}/${a.pinnedModelId ?? "?"}`)
                .join(", "),
          );
        }
      } catch (err) {
        // Non-fatal; guard is advisory.
        console.warn("[pin-audit] check failed:", err);
      }
    }, 20_000);

    // ── First-boot auto-provisioning ───────────────────────────────────────
    // Runs 15s after startup. Detects active providers with zero model
    // profiles (the exact state after a fresh install where the seed +
    // post-init SQL activated providers but no discovery has run yet).
    // This eliminates the need to manually click "Update Providers" or
    // "Run Eval" — the platform is ready to route immediately.
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
            console.log(`[first-boot] Provider "${providerId}" is active but has 0 model profiles — running auto-discovery...`);
            const { autoDiscoverAndProfile } = await import(
              "@/lib/inference/ai-provider-internals"
            );
            const result = await autoDiscoverAndProfile(providerId);
            console.log(`[first-boot] ${providerId}: discovered=${result.discovered}, profiled=${result.profiled}${result.error ? ` (${result.error})` : ""}`);

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

    // ── Periodic revalidation ──────────────────────────────────────────────
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

    // ── Sandbox slot pool initialization ──────────────────────────────────
    // Resets all SandboxSlot rows to "available" on every boot.
    // Handles stale slots from portal crashes without manual intervention:
    // if the portal dies mid-pipeline the new instance immediately frees any
    // held slots so queued builds don't wait indefinitely.
    setTimeout(async () => {
      try {
        const { initializePool } = await import("@/lib/integrate/sandbox/sandbox-pool");
        await initializePool();
        console.log("[sandbox-pool] Slot pool initialized (all slots reset to available)");
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
            const execTerminal = execState?.step === "complete" || execState?.step === "failed";
            const phaseLeft = !build || build.phase !== "build";

            if (phaseLeft || execTerminal) {
              await prisma.sandboxSlot.update({
                where: { id: slot.id },
                data: { status: "available", buildId: null, userId: null, releasedAt: new Date() },
              });
              console.log(
                `[sandbox-pool] Reclaimed stale slot ${slot.slotIndex} from ${slot.buildId}` +
                ` (phase=${build?.phase ?? "not found"}, execStep=${execState?.step ?? "null"})`,
              );
            }
          }
        } catch (err) {
          console.warn("[sandbox-pool] Stale slot reclaim failed (non-fatal):", err);
        }
      }

      await reclaimStaleSandboxSlots();
      setInterval(reclaimStaleSandboxSlots, 30 * 60 * 1000);
    }, 5_000);

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
