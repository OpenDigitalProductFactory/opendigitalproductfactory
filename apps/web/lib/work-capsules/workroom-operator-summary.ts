import { resolveDriveConclusion } from "@/lib/work-management/drive-conclusion";
import type { EffectiveHumanAccountability } from "@/lib/work-management/human-accountability";
import { projectWorkCaseState } from "@/lib/work-management/status-projection";

export type OperatorWorkGroup = "attention" | "working" | "waiting" | "history";
export type WorkroomOperatorSummary = {
  group: OperatorWorkGroup;
  label: string;
  nextAction: string;
  recoveryCondition: string | null;
};

/** Presentation only: safety-held liveness and the recorded drive remain authoritative. */
export function projectWorkroomOperatorSummary(room: {
  capsuleId: string; status: string; liveness: string; isLive: boolean;
  accountability?: EffectiveHumanAccountability;
  drive?: { action: string | null; reason: string | null; attentionRecorded?: boolean } | null;
}): WorkroomOperatorSummary {
  const result = (group: OperatorWorkGroup, label: string, nextAction: string,
    recoveryCondition: string | null = null): WorkroomOperatorSummary => ({ group, label, nextAction, recoveryCondition });
  const state = projectWorkCaseState({ capsule: { capsuleId: room.capsuleId, status: room.status } });
  if (room.status === "ready-for-promotion") return result("attention", "Ready for closeout", "Review the result before closing the room");
  if (state.terminal || (!room.isLive && room.liveness !== "no-signal" && room.liveness !== "recovery-required")) {
    const delivered = room.liveness === "delivered" || state.state === "closed";
    return result("history", delivered ? "Delivered" : room.status === "complete" ? "Closed" : "Session ended", "Open the retained record");
  }
  if (room.accountability?.state === "setup-required") {
    return result("attention", "Owner needed", "Assign an accountable person in the room");
  }
  if (room.drive?.action && ["pause", "escalate", "attention"].includes(room.drive.action)) {
    const conclusion = room.accountability && room.drive.action !== "attention" ? resolveDriveConclusion({
      ...room.drive, action: room.drive.action, reason: room.drive.reason ?? "",
      accountability: room.accountability,
    }) : null;
    return result("attention", "Needs attention", room.drive.action === "attention" && room.drive.attentionRecorded
      ? "Open the room to answer its pending decision" : "Resolve the recorded hold in the room", conclusion?.blockage?.unblockedBy ?? null);
  }
  if (["stalled", "recovery-required", "no-signal"].includes(room.liveness) || state.state === "waiting-on-system") {
    return result("attention", "Check required", "Open the room to check its blocker");
  }
  if (room.liveness === "durable-wait") return result("waiting", "Waiting for capacity", "The system manages queue admission");
  if (room.liveness === "paused") return result("waiting", "Worker paused", "Waiting for the worker to return");
  if (room.liveness === "leased-idle") return result("waiting", "No recent progress", "Check the worker's last result in the room");
  if (room.liveness === "live") return result("working", state.state === "verifying" ? "Checking result" : "Working", "Open the room to follow progress");
  return result("attention", "State not recorded", "Open the room to establish its next step");
}
