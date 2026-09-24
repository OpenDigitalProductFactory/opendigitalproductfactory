import type { ToolResult } from "@/lib/mcp-tools";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { WORK_CAPSULE_EXECUTOR_KINDS, isWorkCapsuleExecutorKind } from "@/lib/work-capsules";

import { admitRoomAssistant } from "./room-ownership";
import { reassignWorkCapsuleExecutor } from "./work-capsule-store";
import type { CapsuleDb, WorkCapsuleActor } from "./work-capsule-store-types";

/**
 * Hand a Workroom to a different executor (reassign_workroom_executor).
 *
 * Lifted out of `mcp-handlers.ts` when BI-821EEB18 made it the handover a
 * person uses to move their own room to a new assistant. When the caller is an
 * assistant acting for a person (OAuth), it is admitted to that one room as a
 * contributor in the same transaction as the executor change, so the room it
 * was handed is one it can open. The governed access gate has already checked
 * that the person owns the room and that nobody removed or narrowed this
 * assistant; `admitRoomAssistant` never re-admits a removed participant either.
 */
export async function reassignCapsuleExecutor(args: {
  params: Record<string, unknown>;
  db: CapsuleDb;
  resolveActor: () => Promise<WorkCapsuleActor>;
}): Promise<ToolResult> {
  const text = (key: string) => {
    const value = args.params[key];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  };
  const capsuleId = text("capsuleId");
  const toExecutorKind = text("toExecutorKind");
  if (!capsuleId || !toExecutorKind) {
    return { success: false, error: "invalid_input", message: "capsuleId and toExecutorKind are required." };
  }
  if (!isWorkCapsuleExecutorKind(toExecutorKind)) {
    return {
      success: false,
      error: "invalid_executor_kind",
      message: `toExecutorKind must be one of: ${WORK_CAPSULE_EXECUTOR_KINDS.join(", ")}.`,
    };
  }
  const rawManifest = args.params["handoffManifest"];
  const handoffManifest = rawManifest && typeof rawManifest === "object" && !Array.isArray(rawManifest)
    ? (rawManifest as Record<string, unknown>)
    : undefined;

  try {
    const actor = await args.resolveActor();
    const run = async (tx: CapsuleDb) => {
      const capsule = await reassignWorkCapsuleExecutor({
        db: tx,
        capsuleId,
        toExecutorKind,
        toExecutorRef: text("toExecutorRef") ?? undefined,
        reason: text("reason") ?? undefined,
        handoffManifest,
        actor,
      });
      const assistant = actor.agentPrincipalId;
      const admission = assistant && tx.workroomParticipant
        ? await admitRoomAssistant(tx as never, capsule.id, assistant)
        : null;
      if (admission?.admitted) {
        await tx.workroomActivity.create({
          data: {
            workCapsuleId: capsule.id,
            kind: "coworker-joined",
            summary: "The room's owner handed it to a new assistant, which was admitted to continue the work.",
            payload: { source: "handover", assistantPrincipalId: assistant, toExecutorKind },
            recordedById: actor.userId,
            recordedByAgentId: actor.agentId,
          },
        });
      }
      return { capsule, admitted: admission?.admitted === true };
    };
    const { capsule, admitted } = args.db.$transaction ? await args.db.$transaction(run) : await run(args.db);
    return {
      success: true,
      entityId: capsule.capsuleId,
      message: admitted
        ? `Reassigned ${capsule.capsuleId} to ${toExecutorKind}; lease transferred and you were admitted. Call get_workroom to see where the work stands.`
        : `Reassigned ${capsule.capsuleId} to ${toExecutorKind}; lease transferred.`,
      data: { capsule, assistantAdmitted: admitted },
    };
  } catch (error) {
    return { success: false, error: "reassign_failed", message: getErrorMessage(error) };
  }
}
