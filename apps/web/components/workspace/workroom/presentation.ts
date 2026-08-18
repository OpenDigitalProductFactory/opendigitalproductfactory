import type {
  WorkroomActivityKind,
} from "@/lib/work-management/room-types";

export const ACTIVITY_KIND_LABEL: Record<WorkroomActivityKind, string> = {
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
