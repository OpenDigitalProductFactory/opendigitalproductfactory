import type { prisma } from "@dpf/db";

// BI-995E9530: the :3001 Contributor preview shares the local-integration-ci
// slot (WWMD decision #5, 2026-06-05) and renews a 2-minute TTL indefinitely.
// Unbounded, one idle preview starved every pre-PR gate on the host (26 gate
// claims queued for 50+ minutes). Past this hold, a preview renews only while
// no gate is waiting; otherwise it yields and may re-queue behind the gates.
// Chosen with principle_decide DI-34AA7F9F14DE (bounded-hold-yield).
export const PREVIEW_MAX_CONTENDED_HOLD_MS = 20 * 60_000;

type YieldDb = Pick<typeof prisma, "nonProductionEnvironmentLease">;

export function isContributorPreviewClaimKey(claimKey: string | null | undefined): boolean {
  return (claimKey ?? "").startsWith("dev-portal:");
}

/** True when a preview has held the shared CI slot past its bound while a gate waits. */
export async function previewMustYieldSlot(
  db: YieldDb,
  lease: { environmentKey: string; claimKey: string | null; admittedAt: Date | null },
  now: Date,
): Promise<boolean> {
  if (lease.environmentKey !== "local-integration-ci") return false;
  if (!isContributorPreviewClaimKey(lease.claimKey) || !lease.admittedAt) return false;
  if (now.getTime() - lease.admittedAt.getTime() < PREVIEW_MAX_CONTENDED_HOLD_MS) return false;
  const waitingGates = await db.nonProductionEnvironmentLease.count({
    where: {
      environmentKey: lease.environmentKey,
      status: "queued",
      claimKey: { startsWith: "gate:" },
      expiresAt: { gt: now },
    },
  });
  return waitingGates > 0;
}
