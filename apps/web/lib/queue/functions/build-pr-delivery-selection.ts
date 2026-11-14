import type { Prisma, PrismaClient } from "@dpf/db";
import { readBuildPrDeliveryState } from "@/lib/build/build-pr-delivery-state";
import { isDeliveryObservationDue } from "@/lib/build/build-pr-delivery-recheck";
import { getCatalogEntry } from "@/lib/operate/scheduled-jobs/catalog";

const ROOM_SCAN_WINDOW = 200;
const ROOMS_PER_RUN = 25;

const roomSelect = {
  id: true,
  capsuleId: true,
  featureBuildId: true,
  repositoryFullName: true,
  headSha: true,
  pullRequestNumber: true,
  pullRequestUrl: true,
  scopeClaims: true,
  executorKind: true,
  workspaceState: true,
  updatedAt: true,
} satisfies Prisma.WorkroomSelect;

/**
 * Walk the existing job's durable cursor, not a room's unrelated updatedAt.
 * Claim the batch before effects: failed or stale-head observations still
 * yield to later rooms, and a crash defers this batch until the next sweep.
 * The cursor is scheduling evidence, never publication or cleanup evidence.
 * A room backing off, or stopped on a cause GitHub can clear, is taken only
 * when it is due (BI-0EDCF2EC).
 */
export async function selectPrDeliveryRooms(
  db: Pick<PrismaClient, "scheduledJob" | "workroom">,
  now: Date = new Date(),
) {
  const definition = getCatalogEntry("build-pr-delivery-reconcile");
  if (!definition) throw new Error("PR delivery job catalog entry is missing");
  const job = await db.scheduledJob.upsert({
    where: { jobId: definition.jobId },
    create: {
      jobId: definition.jobId,
      name: definition.name,
      schedule: definition.cron,
      category: definition.category,
      locked: definition.category === "core",
    },
    update: {},
    select: { id: true, runCursor: true, enabled: true, updatedAt: true },
  });
  if (!job.enabled) return [];

  const where = {
    pullRequestNumber: { not: null },
    pullRequestUrl: { not: null },
    status: { notIn: ["complete", "abandoned", "archived"] },
  };
  const query = { select: roomSelect, take: ROOM_SCAN_WINDOW, orderBy: { id: "asc" as const } };
  let rows = await db.workroom.findMany({
    ...query,
    where: { ...where, ...(job.runCursor ? { id: { gt: job.runCursor } } : {}) },
  });
  // A deleted cursor row needs no special repair: it is a keyset boundary.
  if (!rows.length && job.runCursor) rows = await db.workroom.findMany({ ...query, where });

  const capsules: typeof rows = [];
  let nextCursor: string | null = null;
  for (const row of rows) {
    nextCursor = row.id;
    if (!isDeliveryObservationDue(readBuildPrDeliveryState(row.workspaceState), now)) continue;
    capsules.push(row);
    if (capsules.length === ROOMS_PER_RUN) break;
  }
  // Advance only through consumed rows, including a wholly stopped prefix.
  // Never skip the unconsumed end of a page containing more than 25 live rooms.
  const claimed = await db.scheduledJob.updateMany({
    where: { id: job.id, runCursor: job.runCursor, updatedAt: job.updatedAt, enabled: true },
    data: { runCursor: nextCursor },
  });
  return claimed.count === 1 ? capsules : [];
}
