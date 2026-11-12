import { resolveDriveConclusion } from "@/lib/work-management/drive-conclusion";
import type { EffectiveHumanAccountability } from "@/lib/work-management/human-accountability";
import { projectWorkCaseState } from "@/lib/work-management/status-projection";
import type { MessageKey } from "@dpf/i18n";
import { classifyAtlasHealth, type AtlasHealth, type AtlasHealthFacts } from "@/lib/work-management/atlas-health";
import { isRecord } from "@/lib/shared/coerce";

export type WorkroomNextAction = {
  actor: MessageKey<"workrooms">;
  instruction: MessageKey<"workrooms">;
  decisionRecorded: boolean;
  detail?: string;
  decisionCount?: number;
};

type NextActionInput = {
  status: string; liveness: string;
  executorKind?: string | null;
  drive?: { action: string | null; reason: string | null; attentionRecorded?: boolean } | null;
  recovery?: unknown;
  decisions?: ReadonlyArray<{ title: string; condition: string }>;
};

/** Display allowlist only. Recovery packets and commands never cross this boundary. */
export function projectWorkroomNextAction(room: NextActionInput, condition: string | null = null): WorkroomNextAction | null {
  if (["archived", "complete", "abandoned", "superseded"].includes(room.status)
    || ["delivered", "lease-expired"].includes(room.liveness)) return null;
  const view = (actor: WorkroomNextAction["actor"], instruction: WorkroomNextAction["instruction"]): WorkroomNextAction =>
    ({ actor, instruction, decisionRecorded: false });
  const executor = room.executorKind === "human" ? "inventory.actor.person"
    : room.executorKind ? "inventory.actor.executor" : "inventory.actor.unknown";
  const decisions = room.drive?.action === "attention" ? room.decisions : null;
  if (decisions?.length) {
    const first = decisions[0]!;
    return { actor: "inventory.actor.decisionOwner", instruction: "inventory.action.decision", decisionRecorded: true,
      detail: `${first.title}: ${first.condition}`, decisionCount: decisions.length };
  }
  const recovery = isRecord(room.recovery) ? room.recovery : null;
  const prerequisite = isRecord(recovery?.prerequisite) ? recovery.prerequisite : null;
  if (prerequisite?.accountableRole === "artifact-resolver") return view("inventory.actor.delivery", "inventory.action.source");
  const blocker = isRecord(recovery?.blocker) ? recovery.blocker : null;
  const reviewBlocker = blocker && typeof blocker.reason === "string" && (/review/i.test(blocker.reason)
    || (Array.isArray(recovery?.reviewerExecutions) && recovery.reviewerExecutions.length > 0));
  if (reviewBlocker) {
    const owner = isRecord(blocker.accountableOwner) ? blocker.accountableOwner : null;
    if (typeof owner?.agentId === "string" && owner.agentId.trim()) return view("inventory.actor.requester", "inventory.action.reviewResult");
    if (blocker.accountableRole === "artifact-resolver" || owner?.role === "delivery-coordinator") return view("inventory.actor.delivery", "inventory.action.reviewEvidence");
  }
  if (room.drive?.reason === "executor_writeback_unavailable") return view(executor, "inventory.action.recordResult");
  if (room.drive?.action === "attention") return view("inventory.actor.unknown", "inventory.action.decisionUnknown");
  if (room.status === "ready-for-promotion") return view("inventory.actor.delivery", "inventory.action.delivery");
  if (room.liveness === "durable-wait") return view(executor, "inventory.action.capacity");
  if (room.liveness === "paused" || room.liveness === "leased-idle") return view(executor, "inventory.action.workerResult");
  if (room.liveness === "live" && room.status !== "blocked" && !["pause", "escalate"].includes(room.drive?.action ?? "")) {
    return view(executor, "inventory.action.workerResult");
  }
  return { ...view("inventory.actor.unknown", "inventory.action.unknown"), ...(condition ? { detail: condition } : {}) };
}

export type OperatorWorkGroup = "attention" | "working" | "waiting" | "history";
export type WorkroomOperatorSummary = {
  /** Shared Work Atlas health; `group` is derived from it, never computed separately. */
  health: AtlasHealth;
  group: OperatorWorkGroup;
  label: MessageKey<"workrooms">;
  nextAction: MessageKey<"workrooms">;
  recoveryCondition: string | null;
  action: WorkroomNextAction | null;
};

/** Shared recovery can include rooms older than the recent inventory window. */
export function countOperatorAttention(attentionIds: readonly string[], heldIds: readonly string[] = []): number {
  return new Set([...attentionIds, ...heldIds]).size;
}

const GROUP_BY_HEALTH: Record<AtlasHealth, OperatorWorkGroup> = {
  "needs-person": "attention",
  stuck: "attention",
  "no-signal": "attention",
  finished: "history",
  waiting: "waiting",
  working: "working",
};

const NO_FACTS: AtlasHealthFacts = { needsPerson: false, held: false, finished: false, noSignal: false, waiting: false, working: false };

/** Presentation only: safety-held liveness and the recorded drive remain authoritative. */
export function projectWorkroomOperatorSummary(room: {
  capsuleId: string; status: string; liveness: string; isLive: boolean;
  accountability?: EffectiveHumanAccountability;
  executorKind?: string | null;
  drive?: { action: string | null; reason: string | null; attentionRecorded?: boolean } | null;
  recovery?: unknown;
  decisions?: NextActionInput["decisions"];
}): WorkroomOperatorSummary {
  // Each branch records the one fact it found; the shared classifier names the state and the group follows from it.
  const result = (fact: keyof AtlasHealthFacts, label: MessageKey<"workrooms">, nextAction: MessageKey<"workrooms">,
    recoveryCondition: string | null = null): WorkroomOperatorSummary => {
    const health = classifyAtlasHealth({ ...NO_FACTS, [fact]: true });
    return { health, group: GROUP_BY_HEALTH[health], label, nextAction, recoveryCondition,
      // Keep prerequisite priority in this canonical projection. A secondary
      // action must not hide the existing supported owner-setup instruction.
      action: nextAction === "inventory.nextAction.owner" ? null : projectWorkroomNextAction(room, recoveryCondition) };
  };
  const state = projectWorkCaseState({ capsule: { capsuleId: room.capsuleId, status: room.status } });
  if (room.status === "ready-for-promotion") return result("needsPerson", "inventory.status.closeout", "inventory.nextAction.closeout");
  if (state.terminal || (!room.isLive && room.liveness !== "no-signal" && room.liveness !== "recovery-required")) {
    const delivered = room.liveness === "delivered";
    const closed = room.status === "complete" || state.state === "closed";
    return result("finished", delivered ? "inventory.status.delivered" : closed ? "inventory.status.closed" : "inventory.status.ended", "inventory.nextAction.history");
  }
  if (room.accountability?.state === "setup-required") {
    return result("needsPerson", "inventory.status.ownerNeeded", "inventory.nextAction.owner");
  }
  if (room.drive?.action && ["pause", "escalate", "attention"].includes(room.drive.action)) {
    const conclusion = room.accountability && room.drive.action !== "attention" ? resolveDriveConclusion({
      ...room.drive, action: room.drive.action, reason: room.drive.reason ?? "",
      accountability: room.accountability,
    }) : null;
    const decision = room.drive.action === "attention" && room.drive.attentionRecorded;
    return result(decision ? "needsPerson" : "held", "inventory.status.attention",
      decision ? "inventory.nextAction.decision" : "inventory.nextAction.hold", conclusion?.blockage?.unblockedBy ?? null);
  }
  if (["stalled", "recovery-required", "no-signal"].includes(room.liveness) || state.state === "waiting-on-system") {
    return result(room.liveness === "no-signal" ? "noSignal" : "held", "inventory.status.check", "inventory.nextAction.blocker");
  }
  if (room.liveness === "durable-wait") return result("waiting", "inventory.status.capacity", "inventory.nextAction.capacity");
  if (room.liveness === "paused") return result("waiting", "inventory.status.paused", "inventory.nextAction.paused");
  if (room.liveness === "leased-idle") return result("waiting", "inventory.status.idle", "inventory.nextAction.idle");
  if (room.liveness === "live") return result("working", state.state === "verifying" ? "inventory.status.verifying" : "inventory.status.working", "inventory.nextAction.working");
  return result("noSignal", "inventory.status.unknown", "inventory.nextAction.unknown");
}
