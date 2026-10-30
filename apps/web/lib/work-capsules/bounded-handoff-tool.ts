import { publishRecordedWorkCapsuleActivity } from "./activity-events";
import { revalidatePortalContextForCapsule } from "@/lib/portal-context/invalidation";
import { prisma } from "@dpf/db";
import type { ToolCallConsequence, ToolCallConsequenceInput } from "@/lib/tool-consequence";
import { lockAllNonprodEnvironments } from "@/lib/nonprod/environment-lease-lock";
import { assessBoundedHandoff } from "./bounded-handoff";
import { BoundedHandoffRefusal, handoffDigest, parseBoundedHandoffCommand } from "./bounded-handoff-command";
import { workCapsuleActor } from "./handler-actor";
import type { ReceiptedWorkroomToolOptions } from "./receipted-tool";
import type { CapsuleDb } from "./work-capsule-store-types";

/** This preview only classifies the consequence. The governor still verifies
 * grants and standing delegation, and the writer repeats the proof under locks. */
export async function boundedHandoffConsequenceForCall(call: ToolCallConsequenceInput): Promise<ToolCallConsequence> {
  const authority = { consequence: "authority" as const, reason: "handoff-boundary-unproven" };
  // A batched handover's dry run only reads the set and its plan digest; the
  // apply that changes executors keeps authority (BI-D4144471).
  if (call.toolName === "reassign_workroom_executor" && Object.hasOwn(call.params, "capsuleIds") && call.params.dryRun !== false) {
    return { consequence: null, reason: "batch-handover-dry-run" };
  }
  if (call.toolName !== "reassign_workroom_executor" || call.context?.authSource !== "oauth" || !call.context.agentId) return authority;
  try {
    const command = parseBoundedHandoffCommand(call.params);
    if (!command) return authority;
    const actor = await workCapsuleActor(call.userId, call.context);
    await assessBoundedHandoff({ db: prisma as unknown as CapsuleDb, actor, command });
    return { consequence: null, reason: "verified-same-mandate-handoff" };
  } catch { return authority; }
}

/** Parse and bind before a prior receipt can be replayed. No client field can
 * supply the transaction callback or assert that a boundary is unchanged. */
export const prepareBoundedHandoff: NonNullable<ReceiptedWorkroomToolOptions["prepare"]> = params => {
  try {
    const command = parseBoundedHandoffCommand(params);
    if (!command) return undefined;
    return { params: { ...command }, payloadBinding: { version: 1, digest: handoffDigest(command) }, beforeRoomLock: lockAllNonprodEnvironments,
      afterCommit: receipt => {
        publishRecordedWorkCapsuleActivity(receipt.workCapsuleId, receipt.id);
        revalidatePortalContextForCapsule(command.capsuleId);
      } };
  } catch (error) {
    return { refusal: { success: false,
      error: error instanceof BoundedHandoffRefusal ? error.code : "handoff-invalid-input",
      message: error instanceof Error ? error.message : "The handoff command could not be validated." } };
  }
};
