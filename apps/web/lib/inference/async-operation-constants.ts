export const ASYNC_INFERENCE_OPERATION_RUN_EVENT = "inference/async-operation.run";
export const ASYNC_INFERENCE_OPERATION_RECOVERY_CRON = "*/2 * * * *";
export const ASYNC_INFERENCE_OPERATION_OUTBOX_CRON = "1-59/2 * * * *";
export const ASYNC_INFERENCE_OPERATION_WORKER_ENABLED_FLAG =
  "DPF_ASYNC_OPERATION_WORKER_ENABLED";
export const ASYNC_INFERENCE_INDETERMINATE_RETRY_MS = 30_000;

export const ASYNC_INFERENCE_OPERATION_RECOVERY_INNGEST_ID =
  "inference/async-operation-reconciliation";
export const ASYNC_INFERENCE_OPERATION_OUTBOX_INNGEST_ID =
  "inference/async-operation-outbox";
