export const FOREGROUND_WORK_EVENT = "agent/foreground-work.run";
export const FOREGROUND_BUILD_HANDOFF_BLOCKED = "Build Studio must restore its tracked handoff before this saved request can start. DPF retains your request; you do not need to resend.";
export const FOREGROUND_RECEIPT_PREFIX = "foreground-receipt-";
export const foregroundReceiptId = (taskRunId: string) => `${FOREGROUND_RECEIPT_PREFIX}${taskRunId}`;
