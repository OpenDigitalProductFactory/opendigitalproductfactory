import { err, ok, type ActionResult } from "@/lib/shared/action-result";

/** Receipt kind written once when a dispatched agent stage produces no writeback. */
export const WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND = "blocked";

export const EXECUTOR_WRITEBACK_UNAVAILABLE_REASON = "executor_writeback_unavailable";

export type WorkroomDriveReceipt = { stageKey: string; kind: string };

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
  if (existing.some((entry) => entry.stageKey === stageKey && entry.kind === kind)) {
    return ok([...existing]);
  }
  return ok([
    ...existing.filter((entry) =>
      !(entry.stageKey === stageKey && entry.kind === WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND)
    ),
    { stageKey, kind },
  ]);
}
