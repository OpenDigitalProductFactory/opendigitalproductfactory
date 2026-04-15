// Next.js instrumentation hook — runs once on server startup.
// See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    // Register ScheduledJob rows so the calendar shows discovery events.
    // Actual execution handled by Inngest cron functions (lib/queue/functions/).
    const { registerScheduledJobs } = await import("@/lib/operate/discovery-scheduler");
    registerScheduledJobs().catch((err) =>
      console.error("[instrumentation] Failed to register discovery jobs:", err),
    );

    // ── First-boot auto-provisioning ───────────────────────────────────────
    // Runs 15s after startup. Detects active providers with zero model
    // profiles (the exact state after a fresh install where the seed +
    // post-init SQL activated providers but no discovery has run yet).
    // This eliminates the need to manually click "Update Providers" or
    // "Run Eval" — the platform is ready to route immediately.
    setTimeout(async () => {
      try {
        const { prisma } = await import("@dpf/db");
        const activeProviders = await prisma.modelProvider.findMany({
          where: { status: { in: ["active", "degraded"] } },
          select: { providerId: true },
        });

        for (const { providerId } of activeProviders) {
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
  }
}
