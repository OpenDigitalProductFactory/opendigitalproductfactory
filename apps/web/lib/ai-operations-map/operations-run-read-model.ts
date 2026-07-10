// apps/web/lib/ai-operations-map/operations-run-read-model.ts — EP-8DC217EB BET-10
//
// One canonical TaskRun projection surface for the AI Operations Map. Two
// things were duplicated:
//
//   1. The taskRun `select` clause — copied verbatim across the recent-window
//      and stalled-window queries in load-map-data.ts (same 11 columns). This
//      is the single home; both queries import OPERATIONS_RUN_SELECT.
//
//   2. The TaskRun-status → projection-severity classifier. classifyRunStatus
//      is the canonical form, matching deriveProjectionSeverityFromTaskState
//      (project-events.ts), which now delegates here.
//
// BEHAVIOR-PRESERVATION NOTE — this read-model deliberately does NOT unify the
// other status-mapping helpers the map projectors carry, because they map
// DIFFERENT input domains to DIFFERENT output types and unifying them would
// change behavior:
//   - mapTaskState / mapDelegationState / mapDeliberationState
//     (project-a2a-interactions.ts) → OperationsMapA2aInteractionState
//     (completed/failed/blocked/active) — a2a-edge state, not severity.
//   - toTaskState (conversation-participants-core.ts) → TaskState identity
//     coercion into the closed enum.
//   - mapEngagementStatus (coworker-service-catalog/a2a-tasks.ts) →
//     A2aTaskState — engagement-status → task-state.
//   - severityForTaskRunStatus (project-events.ts) → OperationsMapSeverity too,
//     BUT on the `string` domain it does NOT elevate quiescence/paused states
//     to attention (they fall through to "normal"), whereas classifyRunStatus
//     does. Kept distinct to preserve each surface's observed output.
//
// Cross-epic: BI-83AC1A03's reporting composer consumes this read-model as its
// canonical TaskRun projection source.
import type { Prisma } from "@dpf/db";
import type { OperationsMapSeverity } from "./types";

/**
 * Canonical TaskRun select for AI Operations Map projections. Both the
 * recent-window and stalled-window queries in load-map-data.ts use exactly
 * these columns.
 */
export const OPERATIONS_RUN_SELECT = {
  id: true,
  taskRunId: true,
  status: true,
  source: true,
  currentAgentId: true,
  routeContext: true,
  title: true,
  startedAt: true,
  completedAt: true,
  a2aMetadata: true,
  repeatedPatternKey: true,
} satisfies Prisma.TaskRunSelect;

/** The row shape returned by a query using OPERATIONS_RUN_SELECT. */
export type OperationsRunRow = Prisma.TaskRunGetPayload<{
  select: typeof OPERATIONS_RUN_SELECT;
}>;

/**
 * Canonical TaskRun-status → projection severity. Failure states are critical;
 * operator-actionable states (input/auth-required, stalled, and the
 * quiescence-related pauses) are attention; everything else is normal.
 *
 * Accepts a raw `string` (a TaskRun.status column) so callers holding either a
 * TaskState or an unnarrowed string can use it. See BI-4ab6be39 §9.1 and
 * BI-QUIESCE-001 for the attention-bucket rationale.
 */
export function classifyRunStatus(status: string): OperationsMapSeverity {
  switch (status) {
    case "failed":
    case "rejected":
      return "critical";
    case "input-required":
    case "auth-required":
    case "stalled":
    case "quiescing":
    case "paused-for-upgrade":
    case "paused-for-upgrade-forced":
      return "attention";
    default:
      return "normal";
  }
}
