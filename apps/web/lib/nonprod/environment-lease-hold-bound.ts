import type { prisma } from "@dpf/db";
import { classifyLease, decideHoldBound, CLASS_HOLD_BOUND_MS, type HoldBoundDecision } from "./environment-lease-overseer";
import { admittedLeaseTtlMs, DEFAULT_LEASE_TTL_MS, MAX_LEASE_TTL_MS } from "./environment-lease-timing";

// BI-995E9530: the :3001 Contributor preview shares the local-integration-ci
// slot (WWMD decision #5, 2026-06-05) and renews a 2-minute TTL indefinitely.
// Unbounded, one idle preview starved every pre-PR gate on the host (26 gate
// claims queued for 50+ minutes). Chosen with principle_decide DI-34AA7F9F14DE
// (bounded-hold-yield).
//
// BI-218A4555 generalises that rule to every class (DI-2C6093E878DC): past its
// class bound, a hold renews only while nobody else waits. The bounds and the
// contention rule live in environment-lease-overseer.ts.
export const PREVIEW_MAX_CONTENDED_HOLD_MS = CLASS_HOLD_BOUND_MS.preview as number;

type HoldBoundDb = Pick<typeof prisma, "nonProductionEnvironmentLease">;

export function isContributorPreviewClaimKey(claimKey: string | null | undefined): boolean {
  return (claimKey ?? "").startsWith("dev-portal:");
}

/** Read the live waiters in the holder's environment and decide its bound. */
export async function decideRenewalHoldBound(
  db: HoldBoundDb,
  lease: {
    id: string;
    environmentKey: string;
    status: string;
    claimKey: string | null;
    resourceClass?: string | null;
    ownerSessionId: string;
    ownerProvider?: string | null;
    admittedAt: Date | null;
  },
  now: Date,
): Promise<HoldBoundDecision> {
  // Most renewals are nowhere near the bound: no renewal can reach past it, so
  // whether anyone waits cannot change the answer. Skip the read.
  const classification = classifyLease(lease);
  const admitted = lease.admittedAt?.getTime();
  if (classification.holdBoundMs === null || admitted === undefined || !Number.isFinite(admitted)) {
    return { kind: "unbounded", classification, contended: false };
  }
  const holdBoundAt = new Date(admitted + classification.holdBoundMs);
  if (now.getTime() + MAX_LEASE_TTL_MS < holdBoundAt.getTime()) {
    return { kind: "within-bound", classification, contended: false, holdBoundAt };
  }
  const waiters = await db.nonProductionEnvironmentLease.findMany({
    where: {
      environmentKey: lease.environmentKey,
      status: "queued",
      expiresAt: { gt: now },
      ownerSessionId: { not: lease.ownerSessionId },
    },
    select: {
      id: true, status: true, claimKey: true, resourceClass: true, environmentKey: true,
      ownerSessionId: true, ownerProvider: true, queuedAt: true, heartbeatAt: true, expiresAt: true,
    },
  }) ?? [];
  return decideHoldBound({
    holder: lease,
    waiters,
    now,
    waiterLivenessWindowMs: admittedLeaseTtlMs(lease.environmentKey, DEFAULT_LEASE_TTL_MS),
  });
}
