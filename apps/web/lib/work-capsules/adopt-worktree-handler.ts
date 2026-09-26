import { normalizePersistedScope, parseScopeInput } from "./scope-input";
import type { ToolResult } from "@/lib/mcp-tools";
import { ensureCapsuleWorkItemAnchorNonFatal } from "@/lib/work-capsules/capsule-workitem-anchor.server";
import {
  WORK_CAPSULE_EXECUTOR_KINDS,
  isWorkCapsuleExecutorKind,
} from "@/lib/work-capsules";

import {
  adoptionBindingMismatch,
  resolveAdoptionBacklogBinding,
  type BacklogBindingReader,
} from "./adopt-backlog-binding";
import { branchOccupiedResult, invalidScopeResult } from "./mcp-result-errors";
import { adoptWorktreeCapsule } from "./work-capsule-store";
import type { CapsuleDb, WorkCapsuleActor } from "./work-capsule-store-types";
import { describeRoomOwnership, establishRoomOwnership, resolveRoomOwnershipPrincipals } from "./room-ownership";
import { projectWorkroomIdentityRepair } from "./workroom-recovery-projection";

type ToolContext = { agentId?: string; threadId?: string; taskRunId?: string; routeContext?: string } | undefined;

function stringParam(params: Record<string, unknown>, key: string): string | null {
  const value = params[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}


/**
 * Adopt an existing branch/worktree pair into a Workroom.
 *
 * Lifted out of `mcp-handlers.ts` alongside `claim-backlog-item-handler.ts` when
 * BI-D526F72C gave adoption real argument handling: a resolved backlog binding,
 * a read-back of what was actually stored, and a refusal that names what is
 * occupying the branch.
 */
export async function adoptWorktree(args: {
  params: Record<string, unknown>;
  userId: string;
  context: ToolContext;
  db: CapsuleDb;
  bindingReader: BacklogBindingReader;
  resolveActor: (userId: string, context: ToolContext) => Promise<WorkCapsuleActor>;
  /** Principal.id of a user; used when an agent adopts without OAuth. */
  resolveUserPrincipalId?: (userId: string) => Promise<string | null>;
}): Promise<ToolResult> {
  const { params } = args;
  const title = stringParam(params, "title");
  const objective = stringParam(params, "objective");
  const repositoryFullName = stringParam(params, "repositoryFullName");
  const headBranch = stringParam(params, "headBranch");
  const worktreePath = stringParam(params, "worktreePath");
  const executorKind = stringParam(params, "executorKind");

  if (!title || !objective || !repositoryFullName || !headBranch || !worktreePath) {
    return {
      success: false,
      error: "invalid_input",
      message: "title, objective, repositoryFullName, headBranch, and worktreePath are required.",
    };
  }
  if (executorKind && !isWorkCapsuleExecutorKind(executorKind)) {
    return {
      success: false,
      error: "invalid_executorKind",
      message: `executorKind must be one of: ${WORK_CAPSULE_EXECUTOR_KINDS.join(", ")}.`,
    };
  }
  const validatedExecutorKind = executorKind && isWorkCapsuleExecutorKind(executorKind)
    ? executorKind
    : null;
  try {
    normalizePersistedScope(parseScopeInput(params));
  } catch (error) {
    return invalidScopeResult(error);
  }

  const binding = await resolveAdoptionBacklogBinding(args.bindingReader, params);
  if (!binding.bound) return binding.refusal;
  const boundBacklogItemId = binding.backlogItemId;

  let capsule;
  const actor = await args.resolveActor(args.userId, args.context);
  try {
    capsule = await adoptWorktreeCapsule({
      db: args.db,
      input: {
        title,
        objective,
        repositoryFullName,
        headBranch,
        worktreePath,
        baseBranch: stringParam(params, "baseBranch") ?? null,
        baseSha: stringParam(params, "baseSha") ?? null,
        headSha: stringParam(params, "headSha") ?? null,
        executorKind: validatedExecutorKind,
        executorRef: stringParam(params, "sessionRef") ?? null, // session identity; see the tool schema
        backlogItemId: boundBacklogItemId,
        scope: parseScopeInput(params),
      },
      actor,
    });
  } catch (error) {
    const occupied = branchOccupiedResult(error);
    if (occupied) return occupied;
    throw error;
  }

  const mismatch = adoptionBindingMismatch({
    headBranch,
    requestedBacklogItemId: boundBacklogItemId,
    capsule,
  });
  if (mismatch) return mismatch;

  await ensureCapsuleWorkItemAnchorNonFatal(capsule, "adopted");
  // BI-36FC2981: delivery work is born owned, whichever door created the room.
  const ownership = boundBacklogItemId && args.db.workroomParticipant
    ? await establishNewRoomOwnership(args.db, capsule.id, actor, "adopt", args.resolveUserPrincipalId)
    : null;
  // A bound room without both SHAs cannot have a reviewer routed to it. Say so
  // now, with the exact call that repairs it, rather than at review time.
  const identityRepair = boundBacklogItemId
    ? projectWorkroomIdentityRepair(capsule, {
      title, objective, backlogItemId: boundBacklogItemId, baseBranch: capsule.baseBranch ?? "main",
    })
    : null;
  return {
    success: true,
    entityId: capsule.capsuleId,
    message: [
      boundBacklogItemId
        ? `Adopted ${headBranch} as Work Capsule ${capsule.capsuleId}, bound to ${boundBacklogItemId}.`
        : `Adopted ${headBranch} as Work Capsule ${capsule.capsuleId}.`,
      ownership ?? "",
      identityRepair
        ? `Add the full commit SHA for ${identityRepair.missingFields.join(" and ")} with the packet in data.identityRepair before asking for review.`
        : "",
    ].filter(Boolean).join(" "),
    data: { capsule, ...(identityRepair ? { identityRepair } : {}) },
  };
}

/**
 * Appoint the person the work is for as the new room's owner and admit their
 * assistant. Adopt and create both call this: create_workroom rooms were born
 * with no participants at all (WC-D73AC93B, WC-7BB9B3CD on 2026-09-25), and the
 * drive's repair never reaches a room without a work shape.
 */
export async function establishNewRoomOwnership(
  db: CapsuleDb,
  workroomId: string,
  actor: WorkCapsuleActor,
  source: "adopt" | "create",
  resolveUserPrincipalId?: (userId: string) => Promise<string | null>,
): Promise<string | null> {
  const principals = await resolveRoomOwnershipPrincipals(actor, resolveUserPrincipalId ?? (async (userId) => {
    const { syncUserPrincipal } = await import("@/lib/identity/principal-linking");
    return (await syncUserPrincipal(userId))?.id ?? null;
  }));
  const outcome = await establishRoomOwnership(db as never, { workroomId, ...principals });
  const summary = describeRoomOwnership(outcome);
  if (summary && (outcome.ownerAppointed || outcome.assistantAdmitted)) {
    await db.workroomActivity.create({
      data: {
        workCapsuleId: workroomId,
        kind: "coworker-joined",
        summary,
        payload: { ...outcome, source },
        recordedById: actor.userId,
        recordedByAgentId: actor.agentId,
      },
    });
  }
  return summary;
}
