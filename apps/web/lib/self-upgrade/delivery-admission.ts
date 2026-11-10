import { claimAdmittedRunForWorker } from "@/lib/self-upgrade/run-store";

/** Refuse a second physical execution for an already-consumed admitted event. */
export async function rejectDuplicateSelfUpgradeDelivery(runId?: string) {
  if (!runId) return null;
  const claim = await claimAdmittedRunForWorker(runId);
  return claim === "duplicate"
    ? { skipped: true, reason: "duplicate-delivery", runId }
    : null;
}
