import type { ToolResult } from "@/lib/mcp-tools";
import { ensureCapsuleWorkItemAnchorNonFatal } from "@/lib/work-capsules/capsule-workitem-anchor.server";
import {
  WORK_CAPSULE_EXECUTOR_KINDS,
  isWorkCapsuleExecutorKind,
  normalizeWorkCapsuleScopeInput,
  type WorkCapsuleScopeInput,
} from "@/lib/work-capsules";

import {
  adoptionBindingMismatch,
  resolveAdoptionBacklogBinding,
  type BacklogBindingReader,
} from "./adopt-backlog-binding";
import { branchOccupiedResult, invalidScopeResult } from "./mcp-result-errors";
import { adoptWorktreeCapsule } from "./work-capsule-store";
import type { CapsuleDb, WorkCapsuleActor } from "./work-capsule-store-types";

type ToolContext = { agentId?: string; threadId?: string; taskRunId?: string; routeContext?: string } | undefined;

function stringParam(params: Record<string, unknown>, key: string): string | null {
  const value = params[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseScopeInput(params: Record<string, unknown>): WorkCapsuleScopeInput {
  return {
    workroomShape: params.workroomShape,
    decisionScope: params.decisionScope,
    portfolioRole: params.portfolioRole,
    servedPersona: params.servedPersona,
    activityKind: params.activityKind,
    outcomeAnchor: params.outcomeAnchor,
    servesPortfolioRoles: params.servesPortfolioRoles,
    dependsOnPortfolioRoles: params.dependsOnPortfolioRoles,
  };
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
    normalizeWorkCapsuleScopeInput(parseScopeInput(params));
  } catch (error) {
    return invalidScopeResult(error);
  }

  const binding = await resolveAdoptionBacklogBinding(args.bindingReader, params);
  if (!binding.bound) return binding.refusal;
  const boundBacklogItemId = binding.backlogItemId;

  let capsule;
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
      actor: await args.resolveActor(args.userId, args.context),
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
  return {
    success: true,
    entityId: capsule.capsuleId,
    message: boundBacklogItemId
      ? `Adopted ${headBranch} as Work Capsule ${capsule.capsuleId}, bound to ${boundBacklogItemId}.`
      : `Adopted ${headBranch} as Work Capsule ${capsule.capsuleId}.`,
    data: { capsule },
  };
}
