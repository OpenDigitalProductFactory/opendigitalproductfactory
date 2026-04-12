// model-discovery-scheduler.ts
// Daily model discovery + profiling for all configured AI providers.
// Called by Inngest cron (see lib/queue/functions/model-discovery-refresh.ts).

import { prisma } from "@dpf/db";
import { autoDiscoverAndProfile } from "./ai-provider-internals";

const JOB_ID = "model-discovery-refresh";

/** Register the ScheduledJob row so it appears in the calendar/dashboard. */
export async function registerModelDiscoveryJob(): Promise<void> {
  const now = new Date();
  const nextRun = new Date(now);
  nextRun.setHours(4, 0, 0, 0); // 4 AM
  if (nextRun <= now) nextRun.setDate(nextRun.getDate() + 1);

  await prisma.scheduledJob.upsert({
    where: { jobId: JOB_ID },
    create: {
      jobId: JOB_ID,
      name: "Model discovery: daily refresh",
      schedule: "0 4 * * *",
      nextRunAt: nextRun,
    },
    update: {
      schedule: "0 4 * * *",
      nextRunAt: nextRun,
    },
  });
}

/**
 * Discover and profile models for all configured providers.
 * Each provider is processed independently — one failure doesn't block others.
 */
export async function runModelDiscoveryRefresh(): Promise<void> {
  const providers = await prisma.modelProvider.findMany({
    where: { status: { not: "unconfigured" } },
    select: { providerId: true, name: true },
  });

  console.log(`[model-discovery] Starting daily refresh for ${providers.length} providers`);

  const results: { providerId: string; discovered: number; profiled: number; error?: string }[] = [];

  for (const provider of providers) {
    try {
      const result = await autoDiscoverAndProfile(provider.providerId);
      results.push({
        providerId: provider.providerId,
        discovered: result.discovered,
        profiled: result.profiled,
        error: result.error,
      });
      if (result.error) {
        console.warn(`[model-discovery] ${provider.name}: ${result.error}`);
      } else {
        console.log(`[model-discovery] ${provider.name}: ${result.discovered} discovered, ${result.profiled} profiled`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error";
      console.error(`[model-discovery] ${provider.name} failed: ${msg}`);
      results.push({ providerId: provider.providerId, discovered: 0, profiled: 0, error: msg });
    }
  }

  const totalDiscovered = results.reduce((sum, r) => sum + r.discovered, 0);
  const totalProfiled = results.reduce((sum, r) => sum + r.profiled, 0);
  const failures = results.filter((r) => r.error).length;

  console.log(
    `[model-discovery] Refresh complete: ${totalDiscovered} discovered, ${totalProfiled} profiled, ${failures} failures`,
  );

  // Update ScheduledJob record
  const now = new Date();
  const nextRun = new Date(now);
  nextRun.setDate(nextRun.getDate() + 1);
  nextRun.setHours(4, 0, 0, 0);

  await prisma.scheduledJob.update({
    where: { jobId: JOB_ID },
    data: {
      lastRunAt: now,
      lastStatus: failures === 0 ? "ok" : `partial (${failures} failures)`,
      lastError: failures > 0
        ? results.filter((r) => r.error).map((r) => `${r.providerId}: ${r.error}`).join("; ")
        : null,
      nextRunAt: nextRun,
    },
  }).catch((err) => console.error(`[model-discovery] Failed to update job record:`, err));
}
