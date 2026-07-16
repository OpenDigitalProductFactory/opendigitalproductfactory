// Capacity-drain evaluator (server) — reads live state, applies the pure
// drain-policy, and (when draining) dispatches top demand-ranked ready work via
// the existing governed tee-up. EP-DEMAND-MGMT capacity automation; kernel
// decision DI-5FED0D945EBB (capacity-aware tee-up throttle).

import type { PrismaClient } from "@dpf/db";
import { evaluateDrain, nextWeeklyReset, type DrainDecision } from "./drain-policy";

export type CapacityDrainResult = {
  drained: boolean;
  decision: DrainDecision;
  windowResetAt: string;
  poolExhausted: boolean;
  activeBuilds: number;
  wipCap: number;
  /** Builds actually created this run (0 when not draining). */
  dispatched: number;
};

/**
 * Evaluate whether to drain remaining weekly allocation and, if so, dispatch
 * top-ranked ready work. Safe to call on a schedule — no-op unless enabled AND
 * in the drain window AND the pool is healthy AND slots are free.
 */
export async function evaluateAndDrainCapacity(input: {
  prisma: PrismaClient;
  userId: string;
  now?: Date;
  /** When true, evaluate and report but do NOT dispatch — for a status check. */
  dryRun?: boolean;
}): Promise<CapacityDrainResult> {
  const { prisma, userId } = input;
  const now = input.now ?? new Date();

  const config = await prisma.platformDevConfig.findUnique({
    where: { id: "singleton" },
    select: {
      capacityDrainEnabled: true,
      capacityResetDow: true,
      capacityResetHourUtc: true,
      capacityDrainWindowHours: true,
      capacityDrainMaxDispatch: true,
    },
  });

  const { BUILD_WIP_CAP, TERMINAL_BUILD_PHASES } = await import("@/lib/build/wip-cap");
  const { getAllCliPoolStatuses } = await import("@/lib/routing/cli-pool-status");

  // A pool is "exhausted" if any CLI adapter is currently rate-limited — the
  // allocation is already fully in use (or we're throttled), so we must not push.
  const pools = await getAllCliPoolStatuses();
  const poolExhausted = pools.some((p) => p.isExhausted);

  const activeBuilds = await prisma.featureBuild.count({
    where: { phase: { notIn: [...TERMINAL_BUILD_PHASES] }, abandonedAt: null, parentEpicId: null },
  });

  const resetDow = config?.capacityResetDow ?? 1;
  const resetHourUtc = config?.capacityResetHourUtc ?? 0;
  const windowResetAt = nextWeeklyReset(now, resetDow, resetHourUtc);

  const decision = evaluateDrain({
    enabled: config?.capacityDrainEnabled === true,
    now,
    windowResetAt,
    drainWindowHours: config?.capacityDrainWindowHours ?? 12,
    poolExhausted,
    activeBuilds,
    wipCap: BUILD_WIP_CAP,
    maxDispatch: config?.capacityDrainMaxDispatch ?? 3,
  });

  const shared = {
    decision,
    windowResetAt: windowResetAt.toISOString(),
    poolExhausted,
    activeBuilds,
    wipCap: BUILD_WIP_CAP,
  };

  if (!decision.drain || input.dryRun === true) {
    return { ...shared, drained: false, dispatched: 0 };
  }

  const { runGovernedBacklogTeeUp } = await import("@/lib/governed-backlog-tee-up");
  const teeUp = await runGovernedBacklogTeeUp({
    prisma,
    userId,
    trigger: "capacity-drain",
    limit: decision.targetDispatch,
    // Let the drain fill idle slots up to the WIP cap, past the normal daily cap.
    capOverride: decision.targetDispatch,
  });

  return { ...shared, drained: true, dispatched: teeUp.createdCount };
}
