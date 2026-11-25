/**
 * Admission stays closed while a self-upgrade drain is live (BI-F9EE05E5).
 *
 * The two drain helpers that need quiescence.ts at runtime: the coordinator's
 * level re-assert and the swap step's last check. They live apart from
 * drain-wait.ts because quiescence.ts imports drain-wait.ts (dynamically), so
 * drain-wait.ts must not import quiescence.ts back. Nothing in quiescence.ts or
 * drain-wait.ts imports this module, so it closes no cycle.
 *
 * Spec: docs/superpowers/specs/2026-05-24-activity-quiescence-protocol-design.md §11a.
 */
import { sanitizeForLog } from "@/lib/security/safe-log";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";
import {
  getQuiescenceConfig,
  invalidateQuiescenceCache,
  isTerminalQuiescenceStatus,
  setQuiescenceLevel,
} from "./quiescence";
import { readDrainControl } from "./drain-wait";
import { remainingReadyToSwapMs } from "./ready-to-swap-window";

/**
 * Close admission again if anything reopened it while this drain is live (a
 * portal restart resets the level on boot; an operator or script may write it).
 * Returns true when it had to write. Reads past the 1s level cache.
 */
export async function reassertDrainingLevel(runId: string): Promise<boolean> {
  invalidateQuiescenceCache();
  const current = await getQuiescenceConfig();
  if (current.level === "draining" && current.runId === runId) return false;
  await setQuiescenceLevel("draining", runId);
  console.warn(sanitizeForLog(`[quiescence] ${runId}: level was ${current.level} (${current.runId ?? "no run"}) during a live drain; admission closed again`));
  return true;
}

/**
 * Recovery/swap effects require this exact run's still-closed admission.
 * Unlike a pre-ready coordinator, a swap caller cannot reassert a lost fence.
 */
export async function guardAdmissionClosedForSwap(
  runId: string,
  opts: { selfUpgradeRunId: string; minimumRemainingMs?: number },
): Promise<ActionResult<{ deadline: Date }>> {
  // An ended or operator-aborted drain is never swapped, and admission is not
  // re-closed for it (the abort already reopened it).
  const control = await readDrainControl(runId);
  if (!control) return err(`quiescence run ${runId} not found`);
  if (isTerminalQuiescenceStatus(control.status)) return err(`the drain already ended (${control.status})`);
  if (control.abortRequestedBy) return err(`abort requested by operator ${control.abortRequestedBy}`);
  if (control.status !== "ready-to-swap" || control.trigger !== "self-upgrade" || control.triggerRefId !== opts.selfUpgradeRunId) return err("the drain is not ready for this upgrade");
  invalidateQuiescenceCache();
  const current = await getQuiescenceConfig();
  if (current.level !== "draining" || current.runId !== runId) return err("the upgrade no longer owns closed admission");
  const deadline = control.readyToSwapDeadlineAt;
  if (!deadline || remainingReadyToSwapMs(deadline) <= (opts.minimumRemainingMs ?? 0)) return err("the confirmed maintenance window has expired or has insufficient time");
  return ok({ deadline });
}
