import { prisma } from "@dpf/db";
import { transitionState, setQuiescenceLevel, broadcastQuiescenceCleared } from "./quiescence";

/** A failed caller cannot finish the swap handshake. Do not infer failure from
 * heartbeat silence: healthy promoters deliberately wait without heartbeats. */
export async function recoverOrphanedUpgradeDrains(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 60 * 60 * 1000);
  const candidates = await prisma.quiescenceRun.findMany({
    where: { trigger: "self-upgrade", status: { in: ["ready-to-swap", "swapping"] }, startedAt: { lt: cutoff } },
    select: { runId: true, status: true, triggerRefId: true, lastHeartbeatAt: true }, take: 10,
  });
  let recovered = 0;
  for (const row of candidates) {
    if (!row.triggerRefId) continue;
    const parent = await prisma.selfUpgradeRun.findUnique({
      where: { runId: row.triggerRefId }, select: { status: true, completedAt: true },
    });
    if (parent?.status !== "failed" || !parent.completedAt || parent.completedAt >= cutoff) continue;
    try {
      await transitionState(row.runId, "failed", {
        outcome: "failed", completionSource: "watchdog", completedAt: now,
        outcomeNotes: `Orphaned swap: parent ${row.triggerRefId} has been failed for over one hour`,
      }, now, { status: row.status, lastHeartbeatAt: row.lastHeartbeatAt });
      await setQuiescenceLevel("normal", null, now, row.runId);
      await broadcastQuiescenceCleared({ runId: row.runId, outcome: "failed", triggerRefId: row.triggerRefId, reason: "failed-upgrade-parent" });
      recovered++;
    } catch (error) {
      console.warn("[quiescence] orphan recovery did not complete", row.runId, error);
    }
  }
  return recovered;
}
