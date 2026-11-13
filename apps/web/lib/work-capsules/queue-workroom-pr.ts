/**
 * queue_workroom_pull_request (BI-53BED66C, design D4).
 *
 * The documented landing path queues with `gh pr merge --auto`. The owner's
 * Codex rules make that a prompt, and T3 runs Codex unattended, so PR #7011
 * could not be queued by the coworker that gated it. This is the governed,
 * server-side step: it queues the room's own PR into the merge queue, which
 * still runs every required check, and only when the PR head is the room's
 * head and a passing, unexpired gate result is bound to the room at that head.
 */
import type { ToolResult } from "@/lib/mcp-tool-types";
import type { ToolCallConsequence, ToolCallConsequenceInput } from "@/lib/tool-consequence";
import { recordWorkCapsuleActivity } from "./work-capsule-activity-store";
import type { CapsuleDb, WorkCapsuleActor } from "./work-capsule-store-types";

type Room = {
  id: string; capsuleId: string; headSha: string | null; pullRequestNumber: number | null; repositoryFullName: string | null;
  executorKind: string | null; leaseHolderPrincipalId: string | null; createdByPrincipalId: string | null;
  requestedByPrincipalId: string | null; archivedAt: Date | null; status: string;
};
export type QueuePrDeps = {
  db: CapsuleDb & { externalEvidenceRecord: { findMany(args: unknown): Promise<Array<{ id: string }>> } };
  actor: WorkCapsuleActor;
  /** Passing gate results bound to this room at its head, after the review resolver's checks. */
  resolveGateEvidence(ids: string[], roomId: string): Promise<Array<{ id: string }>>;
  observePr(input: { prNumber: number }): Promise<{ nodeId: string; state: string; merged: boolean; headSha: string; autoMergeEnabled: boolean; mergeQueueEntry: boolean }>;
  enableAutoMerge(input: { nodeId: string; expectedHeadOid: string }): Promise<void>;
};
const EXTERNAL_SURFACES: Readonly<Record<string, string>> = {
  "AGT-EXT-CLAUDE": "claude-desktop", "AGT-EXT-CODEX": "codex-desktop", "AGT-EXT-GROK": "grok-desktop",
};
const refuse = (error: string, message: string): ToolResult => ({ success: false, error, message });

/** The caller is the room's own executor surface acting for the person who owns the room. */
export function isRoomsOwnExecutor(room: Pick<Room, "executorKind" | "leaseHolderPrincipalId" | "createdByPrincipalId" | "requestedByPrincipalId">, actor: WorkCapsuleActor): boolean {
  if (!actor.agentId || !actor.principalId || !room.executorKind) return false;
  if (EXTERNAL_SURFACES[actor.agentId] !== room.executorKind) return false;
  return [room.createdByPrincipalId, room.requestedByPrincipalId, room.leaseHolderPrincipalId].includes(actor.principalId);
}

export async function queueWorkroomPullRequest(params: Record<string, unknown>, deps: QueuePrDeps): Promise<ToolResult> {
  const capsuleId = typeof params.capsuleId === "string" ? params.capsuleId.trim() : "";
  if (!capsuleId) return refuse("invalid_input", "capsuleId is required.");
  const room = await deps.db.workroom.findUnique({ where: { capsuleId } }) as Room | null;
  if (!room || room.archivedAt) return refuse("workroom_not_found", "The Workroom could not be found.");
  if (!isRoomsOwnExecutor(room, deps.actor)) {
    return refuse("not_rooms_executor", "Only the room's own executor, acting for the room's owner, can queue its PR. Take the room over first (reassign_workroom_executor), or ask the owner.");
  }
  if (!room.pullRequestNumber) return refuse("no_pull_request", "This room has no recorded PR. Open it with pnpm land, then queue it.");
  if (!room.headSha || !/^[a-f0-9]{40}$/.test(room.headSha)) return refuse("room_head_unknown", "The room has no recorded head commit. Re-sync it with adopt_worktree(headSha) first.");
  const pr = await deps.observePr({ prNumber: room.pullRequestNumber });
  if (pr.merged || pr.state !== "OPEN") return refuse("pull_request_not_open", `PR #${room.pullRequestNumber} is ${pr.merged ? "already merged" : pr.state.toLowerCase()}.`);
  if (pr.headSha !== room.headSha) {
    return refuse("pull_request_head_differs", `PR #${room.pullRequestNumber} is at ${pr.headSha.slice(0, 12)}, the room at ${room.headSha.slice(0, 12)}. Re-sync the room and re-run the gate on the PR head.`);
  }
  const candidates = await deps.db.externalEvidenceRecord.findMany({
    where: { workCapsuleId: room.id, operationType: "local_integration_ci" }, select: { id: true }, orderBy: { createdAt: "desc" }, take: 20,
  });
  const passing = await deps.resolveGateEvidence(candidates.map((row) => row.id), room.id);
  if (!passing.length) {
    return refuse("gate_evidence_required", "No passing, unexpired gate result is bound to this room at its head. Run pnpm gate:wait on this commit first.");
  }
  if (pr.autoMergeEnabled || pr.mergeQueueEntry) {
    return { success: true, entityId: room.capsuleId, message: `PR #${room.pullRequestNumber} is already queued.`, data: { prNumber: room.pullRequestNumber, headSha: room.headSha, alreadyQueued: true } };
  }
  await deps.enableAutoMerge({ nodeId: pr.nodeId, expectedHeadOid: room.headSha });
  await recordWorkCapsuleActivity(deps.db, {
    workCapsuleId: room.id, kind: "action", actor: deps.actor,
    summary: `PR #${room.pullRequestNumber} queued for merge at ${room.headSha.slice(0, 12)}; the merge queue runs the required checks.`,
    payload: { kind: "pr-queued", prNumber: room.pullRequestNumber, headSha: room.headSha, gateEvidenceId: passing[0].id },
  });
  return { success: true, entityId: room.capsuleId, message: `PR #${room.pullRequestNumber} queued for merge; the merge queue runs the required checks.`,
    data: { prNumber: room.pullRequestNumber, headSha: room.headSha, gateEvidenceId: passing[0].id, alreadyQueued: false } };
}

/**
 * Narrows the declared consequence to ordinary for the room's own executor
 * acting for the room's owner: queueing that person's gated PR is a routine
 * step of their own delivery. Anyone else keeps the owner's decision. The
 * handler repeats every check before it acts.
 */
export async function queueWorkroomPrConsequenceForCall(call: ToolCallConsequenceInput): Promise<ToolCallConsequence> {
  const keep = { consequence: "irreversible" as const, reason: "queue-pr-not-own-room" };
  if (call.context?.authSource !== "oauth" || !call.context.agentId || typeof call.params.capsuleId !== "string") return keep;
  const [{ prisma }, { workCapsuleActor }] = await Promise.all([import("@dpf/db"), import("./handler-actor")]);
  const actor = await workCapsuleActor(call.userId, call.context as never);
  const room = await prisma.workroom.findUnique({ where: { capsuleId: call.params.capsuleId } }) as Room | null;
  return room && !room.archivedAt && isRoomsOwnExecutor(room, actor) ? { consequence: null, reason: "own-room-gated-pr" } : keep;
}
