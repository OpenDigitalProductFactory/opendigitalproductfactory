// Next.js instrumentation hook — runs once on server startup.
// See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Register ScheduledJob rows so the calendar shows discovery events.
    // Actual execution handled by Inngest cron functions (lib/queue/functions/).
    const { registerScheduledJobs } = await import("@/lib/operate/discovery-scheduler");
    registerScheduledJobs().catch((err) =>
      console.error("[instrumentation] Failed to register discovery jobs:", err),
    );

    // EP-MODEL-CAP-001-D: Startup revalidation — runs 90–120s after startup.
    // Jitter avoids thundering-herd when multiple replicas start simultaneously.
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
