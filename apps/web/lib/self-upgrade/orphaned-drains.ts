import { prisma } from "@dpf/db";
import { isLandedSwapFalseFailureReason } from "./landed-swap-identity";
import { transitionState, setQuiescenceLevel, broadcastQuiescenceCleared } from "./quiescence";

/** Backstop the absolute cutoff even if both the caller and its waiting
 * coordinator disappear. Historical rows retain their failed-parent grace. */
export async function recoverOrphanedUpgradeDrains(now = new Date()): Promise<number> {
  const legacyCutoff = new Date(now.getTime() - 60 * 60 * 1000);
  const candidates = await prisma.quiescenceRun.findMany({
    where: {
      trigger: "self-upgrade", status: { in: ["ready-to-swap", "swapping"] },
      OR: [
        { readyToSwapDeadlineAt: { lte: now } },
        { readyToSwapDeadlineAt: null, startedAt: { lt: legacyCutoff } },
      ],
    },
    select: { runId: true, status: true, triggerRefId: true, lastHeartbeatAt: true, readyToSwapDeadlineAt: true }, take: 10,
  });
  let recovered = 0;
  for (const row of candidates) {
    if (!row.triggerRefId) continue;
    const parent = await prisma.selfUpgradeRun.findUnique({
      where: { runId: row.triggerRefId }, select: { status: true, completedAt: true, reason: true },
    });
    const deadline = row.readyToSwapDeadlineAt;
    if (deadline ? deadline > now : parent?.status !== "failed" || !parent.completedAt || parent.completedAt >= legacyCutoff) continue;
    const succeeded = parent?.status === "succeeded";
    const reason = deadline ? "maintenance-deadline-elapsed" : "failed-upgrade-parent";
    try {
      // The running target, not a known replay failure, decides the historical outcome.
      if (parent?.status === "failed" && isLandedSwapFalseFailureReason(parent.reason)) {
        if (deadline) await setQuiescenceLevel("normal", null, now, row.runId);
        continue;
      }
      await transitionState(row.runId, succeeded ? "completed" : "failed", {
        outcome: succeeded ? "succeeded" : "failed", completionSource: "watchdog", completedAt: now,
        ...(succeeded && parent.completedAt ? { swapCompletedAt: parent.completedAt } : {}),
        outcomeNotes: deadline ? `Swap handshake was not settled by ${deadline.toISOString()}`
          : `Orphaned swap: parent ${row.triggerRefId} has been failed for over one hour`,
      }, now, { status: row.status, lastHeartbeatAt: row.lastHeartbeatAt });
      await setQuiescenceLevel("normal", null, now, row.runId);
      await broadcastQuiescenceCleared({ runId: row.runId, outcome: succeeded ? "succeeded" : "failed", triggerRefId: row.triggerRefId, ...(!succeeded ? { reason } : {}) });
      recovered++;
    } catch (error) {
      console.warn("[quiescence] orphan recovery did not complete", row.runId, error);
    }
  }
  return recovered;
}
