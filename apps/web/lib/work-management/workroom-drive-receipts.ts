/** Receipt kind written once when a dispatched agent stage produces no writeback. */
export const WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND = "blocked";

export const EXECUTOR_WRITEBACK_UNAVAILABLE_REASON = "executor_writeback_unavailable";

export type PriorWorkroomDrive = {
  action: string;
  reason: string;
  stageKey: string | null;
};

export function isCompletingWorkroomDriveReceipt(
  receipt: { stageKey: string; kind: string },
  stageKey: string,
): boolean {
  return receipt.stageKey === stageKey && receipt.kind !== WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND;
}
