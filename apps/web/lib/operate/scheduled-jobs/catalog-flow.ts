// Catalog entries for durable flow-control reconciliation. These jobs are
// platform liveness mechanisms rather than operator-tunable business cadence,
// so they remain core-locked and deliberately have no run-now surface.

import type { ScheduledJobCatalogEntry } from "./catalog-types";

export const FLOW_JOB_CATALOG_ENTRIES: readonly ScheduledJobCatalogEntry[] = [
  {
    jobId: "mcp-task-run-dispatch-reconciliation",
    inngestId: "mcp/task-run-dispatch-reconciliation",
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
