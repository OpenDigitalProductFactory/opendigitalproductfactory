import { prisma } from "@dpf/db";
import { isTerminalQuiescenceStatus, TERMINAL_QUIESCENCE_STATUSES, type EnteredStateAt, type QuiescenceRunStatus } from "./quiescence";

export async function transitionState(
  runId: string,
  toStatus: QuiescenceRunStatus,
  patches: {
    initialSnapshot?: unknown;
    finalSnapshot?: unknown;
    swapStartedAt?: Date;
    swapCompletedAt?: Date;
    completedAt?: Date;
    deferReason?: string;
    deferSurface?: string;
    forcedSurfaces?: unknown[];
    outcome?: string;
    completionSource?: string;
    outcomeNotes?: string;
    actualWaitMs?: number;
  } = {},
  now: Date = new Date(),
  expected?: { status: string; lastHeartbeatAt: Date | null },
): Promise<{ status: string; enteredStateAt: EnteredStateAt } | null> {
  const row = await prisma.quiescenceRun.findUnique({
    where: { runId },
    select: { enteredStateAt: true, status: true },
  });
  if (!row) throw new Error(`Quiescence run ${runId} is missing`);
  const correctingLandedSwap = row.status === "failed" && toStatus === "completed"
    && patches.completionSource === "boot-reconciler" && patches.outcome === "succeeded";
  if (isTerminalQuiescenceStatus(row.status) && !correctingLandedSwap) {
    throw new Error(`Quiescence run ${runId} is terminal (${row.status})`);
  }
  const prior =
    (row.enteredStateAt as unknown as EnteredStateAt | null | undefined) ?? {};
  const enteredStateAt: EnteredStateAt = { ...prior, [toStatus]: now.toISOString() };

  const updated = await prisma.quiescenceRun.update({
    where: { runId, status: expected?.status ?? row.status, ...(expected ? { lastHeartbeatAt: expected.lastHeartbeatAt } : {}) },
    data: {
      status: toStatus,
      enteredStateAt: enteredStateAt as unknown as object,
      ...(patches.initialSnapshot !== undefined
        ? { initialSnapshot: patches.initialSnapshot as unknown as object }
        : {}),
      ...(patches.finalSnapshot !== undefined
        ? { finalSnapshot: patches.finalSnapshot as unknown as object }
        : {}),
      ...(patches.swapStartedAt !== undefined ? { swapStartedAt: patches.swapStartedAt } : {}),
      ...(patches.swapCompletedAt !== undefined ? { swapCompletedAt: patches.swapCompletedAt } : {}),
      ...(patches.completedAt !== undefined ? { completedAt: patches.completedAt } : {}),
      ...(patches.deferReason !== undefined ? { deferReason: patches.deferReason } : {}),
      ...(patches.deferSurface !== undefined ? { deferSurface: patches.deferSurface } : {}),
      ...(patches.forcedSurfaces !== undefined
        ? { forcedSurfaces: patches.forcedSurfaces as unknown as object }
        : {}),
      ...(patches.outcome !== undefined ? { outcome: patches.outcome } : {}),
      ...(patches.completionSource !== undefined
        ? { completionSource: patches.completionSource }
        : {}),
      ...(patches.outcomeNotes !== undefined ? { outcomeNotes: patches.outcomeNotes } : {}),
      ...(patches.actualWaitMs !== undefined ? { actualWaitMs: patches.actualWaitMs } : {}),
    },
    select: { status: true, enteredStateAt: true },
  });

  return {
    status: updated.status,
    enteredStateAt: (updated.enteredStateAt as unknown as EnteredStateAt | null) ?? {},
  };
}

/**
 * Coordinator function heartbeat — fired every wait-loop tick. Cheap update;
 * the watchdog (BI-QUIESCE-007) scans `lastHeartbeatAt` to detect crashed
 * coordinators.
 */
export async function heartbeatQuiescenceRun(
  runId: string,
  now: Date = new Date(),
): Promise<void> {
  const updated = await prisma.quiescenceRun.updateMany({
    where: { runId, status: { notIn: [...TERMINAL_QUIESCENCE_STATUSES] } },
    data: { lastHeartbeatAt: now },
  });
  if (updated.count === 0) throw new Error(`Quiescence run ${runId} is terminal or missing`);
}

