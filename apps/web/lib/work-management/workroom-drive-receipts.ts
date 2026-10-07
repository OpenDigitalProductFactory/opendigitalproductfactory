import { err, ok, type ActionResult } from "@/lib/shared/action-result";

/** Receipt kind written once when a dispatched agent stage produces no writeback. */
export const WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND = "blocked";

export const EXECUTOR_WRITEBACK_UNAVAILABLE_REASON = "executor_writeback_unavailable";

/**
 * A receipt the drive holds for a stage. `iteration` (GPP Phase 3c,
 * BI-8875C9DF) scopes a receipt to one pass through a stage on a graph shape:
 * a rework starts a new iteration, and a receipt completes the stage only at
 * its own iteration. Absent means 0, so every receipt written before Phase 3c,
 * and every receipt of a sequential shape, keeps exactly its meaning. Design:
 * docs/superpowers/specs/2026-10-02-gpp-phase-3c-drive-graph-execution-design.md §4.2.
 *
 * `runKey` (BI-086DC167) scopes a graph receipt to one run of the shape: the
 * marking's `cycleKey`, which is the calendar cycle key of the day the run
 * started. A receipt that carries one completes a stage only within that run,
 * so a new run never replays the previous run's receipts. A receipt without
 * one keeps exactly its meaning: every sequential receipt and every receipt
 * written before BI-086DC167. (Sequential receipts reused across days are
 * BI-853120EE, deliberately not changed here: the sequential path stays
 * byte-identical.)
 */
export type WorkroomDriveReceipt = { stageKey: string; kind: string; iteration?: number; runKey?: string };

export type PriorWorkroomDrive = {
  action: string;
  reason: string;
  stageKey: string | null;
  /** The cycle the prior tick belonged to; bounds the writeback latch so a
   *  fail-closed pause is retried next cycle rather than held forever. */
  cycleKey: string | null;
};

export function isCompletingWorkroomDriveReceipt(
  receipt: { stageKey: string; kind: string },
  stageKey: string,
): boolean {
  return receipt.stageKey === stageKey && receipt.kind !== WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND;
}

/**
 * Whether a receipt belongs to the run `runKey` (BI-086DC167): a receipt that
 * carries no run key belongs to every run (its pre-BI-086DC167 meaning), and
 * so does any receipt when the caller does not know the run.
 */
export function receiptInRun(receipt: { runKey?: string }, runKey: string | undefined): boolean {
  return receipt.runKey === undefined || runKey === undefined || receipt.runKey === runKey;
}

/**
 * The iteration-aware form of isCompletingWorkroomDriveReceipt, for the graph
 * path: the receipt completes `stageKey` only at `iteration` (absent reads 0),
 * and, when it carries a run key, only within the run `runKey`
 * (BI-086DC167). The sequential path keeps using
 * isCompletingWorkroomDriveReceipt unchanged.
 */
export function isCompletingWorkroomDriveReceiptAt(
  receipt: { stageKey: string; kind: string; iteration?: number; runKey?: string },
  stageKey: string,
  iteration: number,
  runKey?: string,
): boolean {
  return isCompletingWorkroomDriveReceipt(receipt, stageKey) && (receipt.iteration ?? 0) === iteration && receiptInRun(receipt, runKey);
}

export function appendCompletingWorkroomDriveReceipt(
  existing: readonly WorkroomDriveReceipt[],
  receipt: WorkroomDriveReceipt,
): ActionResult<WorkroomDriveReceipt[]> {
  const stageKey = receipt.stageKey.trim();
  const kind = receipt.kind.trim();
  if (!stageKey || !kind) return err("invalid_receipt");
  if (kind === WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND) {
    return err("blocked_kind_not_completing");
  }
  // Deduplicated on (stageKey, kind, iteration ?? 0, runKey): for a receipt
  // without an iteration or a run key that is exactly the pre-Phase-3c key.
  const iteration = receipt.iteration ?? 0;
  if (existing.some((entry) => entry.stageKey === stageKey && entry.kind === kind && (entry.iteration ?? 0) === iteration
    && entry.runKey === receipt.runKey)) {
    return ok([...existing]);
  }
  return ok([
    ...existing.filter((entry) =>
      !(entry.stageKey === stageKey && entry.kind === WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND)
    ),
    {
      stageKey,
      kind,
      ...(receipt.iteration !== undefined ? { iteration: receipt.iteration } : {}),
      ...(receipt.runKey !== undefined ? { runKey: receipt.runKey } : {}),
    },
  ]);
}
