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
  captureActiveSessionBlockers,
  getQuiescenceConfig,
  invalidateQuiescenceCache,
  isTerminalQuiescenceStatus,
  setQuiescenceLevel,
} from "./quiescence";
import { readDrainControl } from "./drain-wait";

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
 * The swap step's last check: never swap with admission open. If the level is
 * not draining for this run, close admission again, re-capture blockers, and
 * proceed only when no hard work started meanwhile (or the drain is forced).
 * `data.reasserted` says whether admission had to be closed again.
 */
export async function guardAdmissionClosedForSwap(
  runId: string,
  opts: { forced?: boolean } = {},
): Promise<ActionResult<{ reasserted: boolean }>> {
  // An ended or operator-aborted drain is never swapped, and admission is not
  // re-closed for it (the abort already reopened it).
  const control = await readDrainControl(runId);
  if (!control) return err(`quiescence run ${runId} not found`);
  if (isTerminalQuiescenceStatus(control.status)) return err(`the drain already ended (${control.status})`);
  if (control.abortRequestedBy) return err(`abort requested by operator ${control.abortRequestedBy}`);
  if (!(await reassertDrainingLevel(runId))) return ok({ reasserted: false });
  const snapshot = await captureActiveSessionBlockers();
  const hard = snapshot.surfaces.filter((s) => s.kind === "hard");
  if (hard.length > 0 && !opts.forced && !control.forced) {
    return err(`admission reopened before the swap and work started: ${hard.map((s) => s.surface).join(", ")}`);
  }
  return ok({ reasserted: true });
}
