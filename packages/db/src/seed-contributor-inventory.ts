import type { PrismaClient } from "../generated/client/client";

/**
 * Schedule + identifier constants for the contributor-inventory-sync cron.
 *
 * Spec: docs/superpowers/specs/2026-05-26-contributor-inventory-sync-design.md
 *
 * The ScheduledJob row with this jobId is the live heartbeat surfaced in
 * /platform/development/change-lanes. The cron writes its `metadata` field
 * with `{ githubPrEtag: "..." }` so GitHub conditional requests survive the
 * ContributorInventorySyncRun retention sweep.
 *
 * The same jobId is referenced from
 * apps/web/lib/queue/functions/contributor-inventory-sync.ts (heartbeat
 * upsert) and apps/web/lib/contributor-change-lanes/read-model.ts
 * (etag read on the GitHub source). If you change this constant, change
 * the apps/web references in the same PR or the heartbeat row will be
 * orphaned.
 */
export const CONTRIBUTOR_INVENTORY_JOB_ID = "contributor-inventory-sync";
export const CONTRIBUTOR_INVENTORY_JOB_NAME =
  "Contributor inventory sync (platform-managed)";
// 10-minute cadence; the value is recorded for display only — the
// authoritative trigger is the cron expression on the Inngest function.
export const CONTRIBUTOR_INVENTORY_SCHEDULE = "every-10-minutes";

type ScheduledJobSeedClient = Pick<PrismaClient, "scheduledJob">;

/** Returns the next 10-minute boundary strictly after `from`. */
function nextTenMinuteBoundary(from: Date): Date {
  const next = new Date(from);
  next.setUTCSeconds(0, 0);
  const minutes = next.getUTCMinutes();
  const remainder = minutes % 10;
  const advanceBy = remainder === 0 ? 10 : 10 - remainder;
  next.setUTCMinutes(minutes + advanceBy);
  return next;
}

/**
 * Idempotent: create the contributor-inventory-sync ScheduledJob heartbeat
 * row if missing; update name/schedule/nextRunAt on every seed run. Does
 * not clobber lastRunAt / lastStatus / lastError / metadata — those are
 * owned by the runner.
 */
export async function ensureContributorInventoryScheduledJob(
  prisma: ScheduledJobSeedClient,
  now: Date = new Date(),
): Promise<{ created: boolean }> {
  const nextRunAt = nextTenMinuteBoundary(now);

  const existing = await prisma.scheduledJob.findUnique({
    where: { jobId: CONTRIBUTOR_INVENTORY_JOB_ID },
    select: { jobId: true, nextRunAt: true },
  });

  if (existing) {
    await prisma.scheduledJob.update({
      where: { jobId: CONTRIBUTOR_INVENTORY_JOB_ID },
      data: {
        name: CONTRIBUTOR_INVENTORY_JOB_NAME,
        schedule: CONTRIBUTOR_INVENTORY_SCHEDULE,
        nextRunAt: existing.nextRunAt ?? nextRunAt,
      },
    });
    return { created: false };
  }

  await prisma.scheduledJob.create({
    data: {
      jobId: CONTRIBUTOR_INVENTORY_JOB_ID,
      name: CONTRIBUTOR_INVENTORY_JOB_NAME,
      schedule: CONTRIBUTOR_INVENTORY_SCHEDULE,
      nextRunAt,
    },
  });
  return { created: true };
}
