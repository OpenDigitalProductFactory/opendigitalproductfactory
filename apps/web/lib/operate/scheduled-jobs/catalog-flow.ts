// Catalog entries for durable flow-control reconciliation. These jobs are
// platform liveness mechanisms rather than operator-tunable business cadence,
// so they remain core-locked and deliberately have no run-now surface.

import {
  ASYNC_INFERENCE_OPERATION_OUTBOX_CRON,
  ASYNC_INFERENCE_OPERATION_OUTBOX_INNGEST_ID,
  ASYNC_INFERENCE_OPERATION_RECOVERY_CRON,
  ASYNC_INFERENCE_OPERATION_RECOVERY_INNGEST_ID,
} from "@/lib/inference/async-operation-constants";
import type { ScheduledJobCatalogEntry } from "./catalog-types";

export const FLOW_JOB_CATALOG_ENTRIES: readonly ScheduledJobCatalogEntry[] = [
  {
    jobId: "async-inference-operation-reconciliation",
    inngestId: ASYNC_INFERENCE_OPERATION_RECOVERY_INNGEST_ID,
    honorsEnabledGate: true,
    name: "Async inference operation reconciliation",
    purpose:
      "Recovers advisory wake loss for due durable provider operations without repeating a provider-start request.",
    cron: ASYNC_INFERENCE_OPERATION_RECOVERY_CRON,
    cadence: "Every 2 minutes",
    category: "core",
    tracksRunData: false,
    runNowEvent: null,
  },
  {
    jobId: "async-inference-operation-outbox",
    inngestId: ASYNC_INFERENCE_OPERATION_OUTBOX_INNGEST_ID,
    honorsEnabledGate: true,
    name: "Async inference transition outbox",
    purpose:
      "Publishes undelivered durable operation transitions with deterministic identities so consumers can reconcile after event loss.",
    cron: ASYNC_INFERENCE_OPERATION_OUTBOX_CRON,
    cadence: "Every 2 minutes, offset by 1 minute",
    category: "core",
    tracksRunData: false,
    runNowEvent: null,
  },
  {
    jobId: "mcp-task-run-dispatch-reconciliation",
    inngestId: "mcp/task-run-dispatch-reconciliation",
    honorsEnabledGate: true,
    name: "External MCP task dispatch reconciliation",
    purpose:
      "Re-enqueues persisted external MCP TaskRuns whose deterministic background handoff was lost or never claimed.",
    cron: "*/2 * * * *",
    cadence: "Every 2 minutes",
    category: "core",
    tracksRunData: false,
    runNowEvent: null,
  },
  {
    jobId: "nonprod-lease-wait-reconciliation",
    inngestId: "nonprod/lease-wait-reconciliation",
    honorsEnabledGate: true,
    name: "Nonproduction lease wait reconciliation",
    purpose:
      "Re-publishes capacity for the FIFO head of each queued nonproduction environment so durable waiters recover after missed events or worker restarts.",
    cron: "3,8,13,18,23,28,33,38,43,48,53,58 * * * *",
    cadence: "Every 5 minutes, offset by 3 minutes",
    category: "core",
    tracksRunData: false,
    runNowEvent: null,
  },
] as const;
