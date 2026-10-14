import { resolveDriveConclusion } from "@/lib/work-management/drive-conclusion";
import type { EffectiveHumanAccountability } from "@/lib/work-management/human-accountability";
import { projectWorkCaseState } from "@/lib/work-management/status-projection";
import type { MessageKey } from "@dpf/i18n";

export type OperatorWorkGroup = "attention" | "working" | "waiting" | "history";
export type WorkroomOperatorSummary = {
  group: OperatorWorkGroup;
  label: MessageKey<"workrooms">;
  nextAction: MessageKey<"workrooms">;
  recoveryCondition: string | null;
};

/** Presentation only: safety-held liveness and the recorded drive remain authoritative. */
export function projectWorkroomOperatorSummary(room: {
  capsuleId: string; status: string; liveness: string; isLive: boolean;
  accountability?: EffectiveHumanAccountability;
  drive?: { action: string | null; reason: string | null; attentionRecorded?: boolean } | null;
}): WorkroomOperatorSummary {
  const result = (group: OperatorWorkGroup, label: MessageKey<"workrooms">, nextAction: MessageKey<"workrooms">,
    recoveryCondition: string | null = null): WorkroomOperatorSummary => ({ group, label, nextAction, recoveryCondition });
  const state = projectWorkCaseState({ capsule: { capsuleId: room.capsuleId, status: room.status } });
  if (room.status === "ready-for-promotion") return result("attention", "inventory.status.closeout", "inventory.nextAction.closeout");
  if (state.terminal || (!room.isLive && room.liveness !== "no-signal" && room.liveness !== "recovery-required")) {
    const delivered = room.liveness === "delivered" || state.state === "closed";
    return result("history", delivered ? "inventory.status.delivered" : room.status === "complete" ? "inventory.status.closed" : "inventory.status.ended", "inventory.nextAction.history");
  }
  if (room.accountability?.state === "setup-required") {
    return result("attention", "inventory.status.ownerNeeded", "inventory.nextAction.owner");
  }
  if (room.drive?.action && ["pause", "escalate", "attention"].includes(room.drive.action)) {
    const conclusion = room.accountability && room.drive.action !== "attention" ? resolveDriveConclusion({
      ...room.drive, action: room.drive.action, reason: room.drive.reason ?? "",
      accountability: room.accountability,
    }) : null;
    return result("attention", "inventory.status.attention", room.drive.action === "attention" && room.drive.attentionRecorded
      ? "inventory.nextAction.decision" : "inventory.nextAction.hold", conclusion?.blockage?.unblockedBy ?? null);
  }
  if (["stalled", "recovery-required", "no-signal"].includes(room.liveness) || state.state === "waiting-on-system") {
    return result("attention", "inventory.status.check", "inventory.nextAction.blocker");
  }
  if (room.liveness === "durable-wait") return result("waiting", "inventory.status.capacity", "inventory.nextAction.capacity");
  if (room.liveness === "paused") return result("waiting", "inventory.status.paused", "inventory.nextAction.paused");
  if (room.liveness === "leased-idle") return result("waiting", "inventory.status.idle", "inventory.nextAction.idle");
  if (room.liveness === "live") return result("working", state.state === "verifying" ? "inventory.status.verifying" : "inventory.status.working", "inventory.nextAction.working");
  return result("attention", "inventory.status.unknown", "inventory.nextAction.unknown");
}
