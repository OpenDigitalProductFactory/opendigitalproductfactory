import type { Intent } from "@/components/ui/report-kit/statusColors";
import type {
  WorkRoomActivityKind,
  WorkRoomOutcomeView,
} from "@/lib/work-management/room-types";
import type { WorkCaseState } from "@/lib/work-management/case-types";

export const WORK_STATE_INTENT: Record<WorkCaseState, Intent> = {
  intake: "neutral",
  triage: "info",
  active: "accent",
  "waiting-on-person": "warning",
  "waiting-on-system": "danger",
  "awaiting-decision": "warning",
  verifying: "info",
  resolved: "success",
  closed: "neutral",
  cancelled: "neutral",
};

export const OUTCOME_HEALTH_INTENT: Record<
  NonNullable<WorkRoomOutcomeView["health"]>,
  Intent
> = {
  "on-track": "success",
  "at-risk": "warning",
  blocked: "danger",
  idle: "neutral",
  unknown: "neutral",
};

export const ACTIVITY_KIND_LABEL: Record<WorkRoomActivityKind, string> = {
  message: "Message",
  ask: "Input needed",
  "coworker-joined": "Coworker joined",
  "coworker-left": "Coworker left",
  "coworker-handoff": "Coworker handoff",
  "work-started": "Work started",
  "work-paused": "Work paused",
  "work-completed": "Work completed",
  "decision-proposed": "Decision proposed",
  "decision-resolved": "Decision resolved",
  "artifact-added": "Artifact added",
  "governed-action": "Governed action",
  "external-event": "External event",
  verification: "Verification",
  receipt: "Receipt",
  "cycle-opened": "Cycle opened",
  "cycle-closed": "Cycle closed",
  "cycle-carried-over": "Cycle carried over",
};

export function roomLabel(value: string): string {
  return value
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function activityIntent(kind: WorkRoomActivityKind): Intent {
  if (kind === "decision-resolved" || kind === "work-completed" || kind === "cycle-closed") {
    return "success";
  }
  if (kind === "ask" || kind === "decision-proposed" || kind === "coworker-handoff") {
    return "warning";
  }
  if (kind === "verification" || kind === "receipt" || kind === "artifact-added") {
    return "info";
  }
  if (kind === "message" || kind === "external-event") return "neutral";
  return "accent";
}
