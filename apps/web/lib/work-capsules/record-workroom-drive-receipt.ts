import { prisma } from "@dpf/db";
import type { ToolResult } from "@/lib/mcp-tools";
import { err, ok } from "@/lib/shared/action-result";
import { isRecord } from "@/lib/shared/coerce";
import { appendCompletingWorkroomDriveReceipt } from "@/lib/work-management/workroom-drive-receipts";
import { readStoredWorkroomDriveState } from "@/lib/work-management/workroom-drive-state";
import { recordWorkCapsuleActivity } from "./work-capsule-activity-store";
import type { CapsuleDb, WorkCapsuleActor } from "./work-capsule-store-types";
import { workCapsuleActor } from "./handler-actor";

type ToolContext = { agentId?: string } | undefined;

type ReceiptDb = CapsuleDb & Pick<typeof prisma, "scheduledAgentTask" | "workroomParticipant">;

function stringParam(params: Record<string, unknown>, key: string): string | null {
  const value = params[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export async function recordWorkroomDriveReceipt(args: {
  db: ReceiptDb;
  capsuleId: string;
  stageKey: string;
  kind: string;
  summary?: string;
  actor: WorkCapsuleActor;
}) {
  const capsule = await args.db.workroom.findUnique({
    where: { capsuleId: args.capsuleId },
  });
  if (!capsule) return err(`Workroom ${args.capsuleId} was not found.`);
  const existingState = isRecord(capsule.workspaceState) ? capsule.workspaceState : {};
  const drive = isRecord(existingState.workroomDrive) ? existingState.workroomDrive : {};
  const stored = readStoredWorkroomDriveState(capsule.workspaceState);
  if (!stored.currentStageKey) {
    return err("This Workroom has no current drive stage to complete.");
  }
  if (args.stageKey !== stored.currentStageKey) {
    return err(`Stage ${args.stageKey} is not the current drive stage (${stored.currentStageKey}).`);
  }
  const appended = appendCompletingWorkroomDriveReceipt(stored.receipts, {
    stageKey: args.stageKey,
    kind: args.kind,
  });
  if (!appended.ok) {
    return err(
      appended.error === "blocked_kind_not_completing"
        ? "A blocked receipt does not complete a stage. Use a completing kind."
        : "stageKey and kind are required.",
    );
  }
  if (drive.action !== "dispatch_agent"
    && !(drive.action === "pause" && drive.reason === "executor_writeback_unavailable")) {
    return err("Only a dispatched agent stage accepts this receipt; human decisions use their governed approval path.");
  }
  const coordinator = args.actor.principalId
    ? await args.db.workroomParticipant.findFirst({
      where: { workroomId: capsule.id, principalId: args.actor.principalId,
        lifecycle: "active", assignmentSource: "explicit", roles: { has: "coordinator" } },
      select: { id: true },
    }) : null;
  const dispatched = typeof drive.taskId === "string"
    ? await args.db.scheduledAgentTask.findUnique({
      where: { taskId: drive.taskId }, select: { agentId: true },
    }) : null;
  if (!dispatched) return err("No dispatched task is bound to this stage.");
  if (!coordinator && (!args.actor.agentId || dispatched?.agentId !== args.actor.agentId)) {
    return err("Only the dispatched worker or explicit Process Overseer can complete this stage.");
  }
  if (capsule.archivedAt || ["complete", "abandoned", "archived"].includes(capsule.status)) {
    return err("A terminal Workroom cannot accept a stage receipt.");
  }
  const updated = await args.db.workroom.update({
    where: { capsuleId: args.capsuleId, updatedAt: capsule.updatedAt },
    data: {
      workspaceState: {
        ...existingState,
        workroomDrive: {
          ...drive,
          receipts: appended.data,
        },
      },
    },
  });
  await recordWorkCapsuleActivity(args.db, {
    workCapsuleId: capsule.id,
    kind: "evidence-recorded",
    summary: args.summary?.trim() || `Recorded completing receipt ${args.kind} for stage ${args.stageKey}`,
    payload: { stageKey: args.stageKey, kind: args.kind, receipts: appended.data },
    actor: args.actor,
  });
  return ok({ id: updated.id, capsuleId: updated.capsuleId });
}

export async function recordWorkroomDriveReceiptTool(
  params: Record<string, unknown>,
  userId: string,
  context: ToolContext,
): Promise<ToolResult> {
  const capsuleId = stringParam(params, "capsuleId");
  const stageKey = stringParam(params, "stageKey");
  const kind = stringParam(params, "kind");
  if (!capsuleId || !stageKey || !kind) {
    return {
      success: false,
      error: "invalid_input",
      message: "capsuleId, stageKey, and kind are required.",
    };
  }
  const actor = await workCapsuleActor(userId, context);
  const result = await recordWorkroomDriveReceipt({
    db: prisma as unknown as ReceiptDb,
    capsuleId,
    stageKey,
    kind,
    summary: stringParam(params, "summary") ?? undefined,
    actor,
  });
  if (!result.ok) {
    const code = result.error.includes("blocked")
      ? "blocked_kind_not_completing"
      : result.error.includes("not found")
        ? "not_found"
        : result.error.includes("no current drive stage")
          ? "no_current_stage"
          : result.error.includes("not the current drive stage")
            ? "stage_mismatch"
            : "invalid_receipt";
    return { success: false, error: code, message: result.error };
  }
  return {
    success: true,
    entityId: result.data.capsuleId,
    message: `Recorded completing receipt ${kind} for ${capsuleId} stage ${stageKey}.`,
    data: result.data,
  };
}
