import { publishRecordedWorkCapsuleActivity } from "./activity-events";
import { revalidatePortalContextForCapsule } from "@/lib/portal-context/invalidation";
import { prisma } from "@dpf/db";
import type { ToolCallConsequence, ToolCallConsequenceInput } from "@/lib/tool-consequence";
import { lockAllNonprodEnvironments } from "@/lib/nonprod/environment-lease-lock";
import { assessBoundedHandoff } from "./bounded-handoff";
import { BoundedHandoffRefusal, handoffDigest, parseBoundedHandoffCommand } from "./bounded-handoff-command";
import { workCapsuleActor } from "./handler-actor";
import { assessOwnRoomTakeover, type OwnRoomTakeover } from "./own-room-takeover";
import type { ReceiptedWorkroomToolOptions } from "./receipted-tool";
import type { CapsuleDb } from "./work-capsule-store-types";

const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;

/** The one-call or batched takeover a call describes, or null when it is not one. */
function takeoversOf(params: Record<string, unknown>): OwnRoomTakeover[] | null {
  const toExecutorKind = text(params.toExecutorKind);
  if (!toExecutorKind) return null;
  const expected = params.expectedLeaseHolderPrincipalId;
  const shared = { toExecutorKind, toExecutorRef: text(params.toExecutorRef),
    ...(expected === null || typeof expected === "string" ? { expectedLeaseHolderPrincipalId: expected } : {}) };
  if (Object.hasOwn(params, "capsuleIds")) {
    const ids = Array.isArray(params.capsuleIds) ? params.capsuleIds.map(text) : [];
    return ids.length && ids.length <= 20 && ids.every(Boolean) ? ids.map(capsuleId => ({ ...shared, capsuleId: capsuleId! })) : null;
  }
  const capsuleId = text(params.capsuleId);
  return capsuleId ? [{ ...shared, capsuleId }] : null;
}

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
  let command: ReturnType<typeof parseBoundedHandoffCommand>;
  try { command = parseBoundedHandoffCommand(call.params); }
  catch {
    // BI-1986D3C1: a malformed phase call changes nothing. The handler refuses
    // it before any read or write, with a message the assistant can act on.
    return { consequence: null, reason: "handoff-invalid-input" };
  }
  try {
    const actor = await workCapsuleActor(call.userId, call.context);
    if (!command) {
      // BI-1986D3C1: the owner's own assistant taking over a room the owner owns.
      const takeovers = takeoversOf(call.params);
      if (!takeovers) return authority;
      for (const takeover of takeovers) await assessOwnRoomTakeover({ db: prisma as unknown as CapsuleDb, actor, takeover });
      return { consequence: null, reason: "own-room-takeover" };
    }
    await assessBoundedHandoff({ db: prisma as unknown as CapsuleDb, actor, command });
    return { consequence: null, reason: "verified-same-mandate-handoff" };
  } catch (error) {
    // BI-53BED66C: an approval cannot make a refused two-step call succeed —
    // the approved re-run repeats this same predicate and refuses again
    // (envelopes cmweiy4zf00op0eqlz0xpctw0, cmwfdcrs400580ep4k6we4wux). So a
    // phase call the handler will refuse is classified ordinary: the caller
    // gets the refusal and its next step, and no unusable envelope reaches the
    // owner. Out-of-scope handovers keep their approval on the one-call path.
    if (command && error instanceof BoundedHandoffRefusal) return { consequence: null, reason: `handoff-refused:${error.code}` };
    // Record which boundary refused, so "why did this reach the owner?" is
    // answerable from the decision log instead of re-derived (BI-F1FC0B62).
    return error instanceof BoundedHandoffRefusal ? { ...authority, reason: `${authority.reason}:${error.code}` } : authority;
  }
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
