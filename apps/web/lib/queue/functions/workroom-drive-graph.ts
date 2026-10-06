// apps/web/lib/queue/functions/workroom-drive-graph.ts
//
// Applies a graph room's drive plan: one task per parallel branch under the
// room's one lease (BI-8875C9DF, GPP Phase 3c PR-3c-2). Design:
// docs/superpowers/specs/2026-10-02-gpp-phase-3c-drive-graph-execution-design.md
// §6 ("Dispatch every tick"), §6.1; plan:
// docs/superpowers/plans/2026-10-02-gpp-phase-3c-drive-graph-execution.md
// (PR-3c-2, workroom-drive.ts / applyDrivePlan).
//
// applyDrivePlan (workroom-drive.ts) hands a plan here only when its shape is
// on the graph path (graphSnapshotFields returned fields), so a sequential
// room never reaches this module. It lives apart from workroom-drive.ts to
// keep that module under its size ceiling (scripts/check-module-size.mjs).
//
// - The lease is acquired once; then every branch whose token plan is
//   `dispatch_agent` is upserted through the task id fixed on its token.
// - The snapshot records `dispatchedStageKeys`, which the per-stage dispatch
//   loader (loadStageDispatchTimesByStage) reads to bound each branch's
//   evidence.
// - A branch task whose token left its stage, or paused, is deactivated in the
//   same tick; a plan without token plans (stop, success, do_not_wake, a
//   conformance or fail-closed pause) deactivates every task the prior
//   marking names (graphTaskEffects).
// - A lease held by another worker changes nothing, exactly as on the
//   sequential path.

import type { DriveReasonFor } from "@/lib/work-management/drive-conclusion";
import { graphTaskEffects, withUndispatchedTokensRestored } from "@/lib/work-management/drive-graph-tick";
import type { DriveMarking } from "@/lib/work-management/drive-marking";
import type { DrivePlan } from "@/lib/work-management/drive-resolution";
import { buildStageBrief, stageBriefInputFromDefinition } from "@/lib/work-management/stage-briefing";
import {
  WORKROOM_DRIVE_ACTIVITY_KIND,
  WORKROOM_DRIVE_ATTENTION_KIND,
  WORKROOM_DRIVE_LEASE_MS,
} from "@/lib/work-management/workroom-drive-constants";

import type { WorkroomDriveEffects, WorkroomDriveRoom } from "./workroom-drive";

type Outcome = "dispatched" | "attention" | "stopped" | "skipped";

function outcomeOf(action: DrivePlan["action"]): Outcome {
  if (action === "attention") return "attention";
  if (action === "stop") return "stopped";
  return "skipped";
}

export async function applyGraphDrivePlan(input: {
  room: WorkroomDriveRoom;
  plan: DrivePlan;
  now: Date;
  effects: WorkroomDriveEffects;
  snapshot: Record<string, unknown>;
  persist: WorkroomDriveEffects["persist"];
}): Promise<Outcome> {
  const { room, plan, now, effects, snapshot, persist } = input;
  const { dispatch, deactivate } = graphTaskEffects(plan, room.workspaceState, room.capsuleId);
  const deactivateLeft = async () => {
    for (const taskId of deactivate) await effects.deactivateAgentTask(taskId);
  };
  const activityKind = plan.action === "attention" ? WORKROOM_DRIVE_ATTENTION_KIND : WORKROOM_DRIVE_ACTIVITY_KIND;

  if (dispatch.length === 0) {
    await deactivateLeft();
    await persist({
      roomId: room.id,
      snapshot,
      activityKind,
      summary: plan.action === "attention"
        ? `Stage ${plan.stageKey ?? "unknown"} waiting on ${plan.attentionPrincipalRef ?? "a human"}`
        : plan.action === "do_not_wake" ? `Drive did not wake: ${plan.reason}` : `Drive ${plan.action}: ${plan.reason}`,
      payload: snapshot,
    });
    return outcomeOf(plan.action);
  }

  const expiresAt = new Date(now.getTime() + WORKROOM_DRIVE_LEASE_MS);
  const lease = await effects.acquireLease({
    roomId: room.id,
    now,
    holderPrincipalId: room.leaseHolderPrincipalId,
    expiresAt,
    currentExpiresAt: room.leaseExpiresAt,
    currentHolder: room.leaseHolderPrincipalId,
  });
  if (lease === "held") {
    const observed = {
      ...snapshot,
      action: "dispatch_agent",
      reason: "lease_held" satisfies DriveReasonFor<"dispatch_agent">,
      dispatchedStageKeys: [],
    };
    await persist({
      roomId: room.id,
      snapshot: observed,
      activityKind: WORKROOM_DRIVE_ACTIVITY_KIND,
      summary: "Drive lease held by another worker; stage remains eligible when it expires.",
      payload: observed,
      observationOnly: true,
    });
    return "skipped";
  }
  if (!room.ownerUserId) {
    const unowned = {
      ...snapshot,
      action: "dispatch_agent",
      reason: "missing_task_owner" satisfies DriveReasonFor<"dispatch_agent">,
      dispatchedStageKeys: [],
    };
    await deactivateLeft();
    await persist({
      roomId: room.id,
      snapshot: unowned,
      activityKind: WORKROOM_DRIVE_ACTIVITY_KIND,
      summary: "Agent stage is eligible but no owner user is bound for ScheduledAgentTask.",
      payload: unowned,
    });
    return "skipped";
  }

  const dispatched: string[] = [];
  const failed: string[] = [];
  for (const token of dispatch) {
    // GPP element 2 "Attachment" + element 5 "Capability set": each branch's
    // task carries only its own stage's declared tools (design §11, correction 7).
    const brief = stageBriefInputFromDefinition({ capsuleId: room.capsuleId, roomObjective: room.objective ?? null,
      shapeKey: plan.shapeKey ?? "", shapeVersion: plan.shapeVersion ?? "", definition: plan.definition ?? null, stageKey: token.stageKey });
    const scheduled = await effects.upsertAgentTask({
      taskId: token.taskId as string,
      agentId: token.agentId as string,
      ownerUserId: room.ownerUserId,
      title: `Workroom ${room.capsuleId} / ${token.stageKey}`,
      prompt: buildStageBrief(brief),
      stage: { shapeKey: brief.shapeKey, shapeVersion: brief.shapeVersion, stageKey: brief.stageKey, tools: [...(brief.stageTools ?? [])] },
      now,
      lease: { roomId: room.id, expiresAt, holderPrincipalId: room.leaseHolderPrincipalId },
    });
    (scheduled ? dispatched : failed).push(token.stageKey);
  }
  // As on the sequential path: a dispatch tick whose dispatch never scheduled writes nothing.
  if (dispatched.length === 0 && plan.action === "dispatch_agent") return "skipped";

  await deactivateLeft();
  const marking = plan.marking && !("raw" in plan.marking) && plan.definition
    ? withUndispatchedTokensRestored(plan.marking, room.workspaceState, plan.definition, failed)
    : null;
  const written: Record<string, unknown> = { ...snapshot, ...(marking ? { marking: marking satisfies DriveMarking } : {}), dispatchedStageKeys: dispatched };
  const taskIds = dispatch.filter((token) => dispatched.includes(token.stageKey)).map((token) => token.taskId);
  await persist({
    roomId: room.id,
    snapshot: written,
    activityKind,
    summary: dispatched.length > 0
      ? `Dispatched ${taskIds.join(", ")} for stage${dispatched.length === 1 ? "" : "s"} ${dispatched.join(", ")}`
      : `Drive ${plan.action}: ${plan.reason}`,
    payload: written,
    ...(dispatched.length > 0 ? { lease: { expiresAt, holderPrincipalId: room.leaseHolderPrincipalId } } : {}),
  });
  return dispatched.length > 0 ? "dispatched" : outcomeOf(plan.action);
}
