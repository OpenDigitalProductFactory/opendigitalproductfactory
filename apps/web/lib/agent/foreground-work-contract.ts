export const FOREGROUND_WORK_EVENT = "agent/foreground-work.run";
export const FOREGROUND_RECEIPT_PREFIX = "foreground-receipt-";
export const foregroundReceiptId = (taskRunId: string) => `${FOREGROUND_RECEIPT_PREFIX}${taskRunId}`;
