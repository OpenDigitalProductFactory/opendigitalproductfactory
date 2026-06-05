// apps/web/lib/tak/task-state-intent.ts
//
// EP-A2A Slice 1A — single source of truth mapping an A2A TaskState to a
// report-kit status Intent, so collaboration UI does not carry local status
// color maps (AGENTS.md §12; spec A4). Reused by ConversationParticipantRail
// and CollaborationActivityPanel.

import type { TaskState } from "@/lib/tak/task-states";
import { TASK_IN_FLIGHT_STATES } from "@/lib/tak/task-states";
import type { Intent } from "@/components/ui/report-kit/statusColors";

export function taskStateIntent(state: TaskState): Intent {
  switch (state) {
    case "completed":
    case "archived":
      return "success";
    case "failed":
    case "rejected":
    case "stalled":
    case "paused-for-upgrade-forced":
      return "danger";
    case "input-required":
    case "auth-required":
      return "warning";
    case "working":
    case "submitted":
      return "accent";
    default:
      return "neutral";
  }
}

/** A task is in-flight (not terminal) per the canonical TASK_IN_FLIGHT_STATES set. */
export function isTaskInFlight(state: TaskState): boolean {
  return (TASK_IN_FLIGHT_STATES as readonly string[]).includes(state);
}
