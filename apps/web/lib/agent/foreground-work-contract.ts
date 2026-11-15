export const FOREGROUND_WORK_EVENT = "agent/foreground-work.run";
export const FOREGROUND_BUILD_HANDOFF_BLOCKED = "Build Studio must restore its tracked handoff before this saved request can start. DPF retains your request; you do not need to resend.";
export const FOREGROUND_RECEIPT_PREFIX = "foreground-receipt-";
export const FOREGROUND_CAPACITY_WAIT = "Your request is retained. DPF will retry when provider capacity permits, within its original recovery window. You do not need to resend.";
export const FOREGROUND_SETTLED_WAIT = "Earlier capacity wait. Coworker response saved.";
export const foregroundCapacityNotice = (taskRunId: string) => `${FOREGROUND_CAPACITY_WAIT}\n\nJob: ${taskRunId}`;
export const foregroundReceiptId = (taskRunId: string) => `${FOREGROUND_RECEIPT_PREFIX}${taskRunId}`;
