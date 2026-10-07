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
 */
export type WorkroomDriveReceipt = { stageKey: string; kind: string; iteration?: number };

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
 * The iteration-aware form of isCompletingWorkroomDriveReceipt, for the graph
 * path: the receipt completes `stageKey` only at `iteration` (absent reads 0).
 * The sequential path keeps using isCompletingWorkroomDriveReceipt unchanged.
 */
export function isCompletingWorkroomDriveReceiptAt(
  receipt: { stageKey: string; kind: string; iteration?: number },
  stageKey: string,
  iteration: number,
): boolean {
  return isCompletingWorkroomDriveReceipt(receipt, stageKey) && (receipt.iteration ?? 0) === iteration;
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
  // Deduplicated on (stageKey, kind, iteration ?? 0): for a receipt without an
  // iteration that is exactly the pre-Phase-3c key.
  const iteration = receipt.iteration ?? 0;
  if (existing.some((entry) => entry.stageKey === stageKey && entry.kind === kind && (entry.iteration ?? 0) === iteration)) {
    return ok([...existing]);
  }
  return ok([
    ...existing.filter((entry) =>
      !(entry.stageKey === stageKey && entry.kind === WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND)
    ),
    receipt.iteration !== undefined ? { stageKey, kind, iteration: receipt.iteration } : { stageKey, kind },
  ]);
}
