import type { ToolResult } from "@/lib/mcp-tools";
import { WORK_INTENTS, type WorkIntent } from "@/lib/work-capsules";
import { ensureCapsuleWorkItemAnchorWithPrisma } from "@/lib/work-capsules/capsule-workitem-anchor.server";

import { providerToExecutorKind } from "./external-session-capture";
import { claimGovernedBacklogWorkspace } from "./governed-work-claim";
import { branchOccupiedResult } from "./mcp-result-errors";
import { defaultPlatformRepositoryFullName } from "./work-capsule-branch-identity";
import { BacklogItemAlreadyClaimedError } from "./backlog-workroom-ownership";
import type { CapsuleDb, WorkCapsuleActor } from "./work-capsule-store-types";

type ToolContext = { agentId?: string; threadId?: string; taskRunId?: string; routeContext?: string } | undefined;

function stringParam(params: Record<string, unknown>, key: string): string | null {
  const value = params[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function claimBacklogItemForWork(args: {
  params: Record<string, unknown>;
  userId: string;
  context: ToolContext;
  db: CapsuleDb;
  resolveActor: (userId: string, context: ToolContext) => Promise<WorkCapsuleActor>;
}): Promise<ToolResult> {
  const { params } = args;
  const itemId = stringParam(params, "itemId");
  const worktreePath = stringParam(params, "worktreePath");
  const branchName = stringParam(params, "branchName");
  const provider = stringParam(params, "provider");
  const sessionRef = stringParam(params, "sessionRef");
  const requestedIntent = stringParam(params, "workIntent");
  if (!itemId || !worktreePath || !branchName || !provider || !sessionRef) {
    return { success: false, error: "invalid_input", message: "itemId, worktreePath, branchName, provider, and sessionRef are required." };
  }
  if (requestedIntent && !WORK_INTENTS.includes(requestedIntent as WorkIntent)) {
    return { success: false, error: "invalid_work_intent", message: `workIntent must be one of: ${WORK_INTENTS.join(", ")}.` };
  }
  const repositoryFullName = stringParam(params, "repositoryFullName")
    ?? defaultPlatformRepositoryFullName();
  try {
    const governed = await claimGovernedBacklogWorkspace({
      db: args.db,
      input: {
        backlogItemId: itemId,
        repositoryFullName,
        headBranch: branchName,
        worktreePath,
        baseBranch: stringParam(params, "baseBranch") ?? "main",
        executorKind: providerToExecutorKind(provider),
        executorRef: sessionRef,
        force: params["force"] === true,
        overrideReason: stringParam(params, "overrideReason"),
      },
      actor: await args.resolveActor(args.userId, args.context),
      workIntent: requestedIntent as WorkIntent | null,
    });
    if (!governed.ok) {
      return {
        success: false,
        error: governed.data.code,
        message: governed.error,
        data: {
          workIntent: governed.data.workIntent,
          readiness: governed.data.readiness,
          recovery: governed.data.recovery,
        },
      };
    }
    const result = governed.data.claim;
    await ensureCapsuleWorkItemAnchorWithPrisma({
      capsuleId: result.capsuleId,
      backlogItemId: result.backlogItemId,
      title: `Work on ${result.backlogItemId}`,
    }).catch((error) => {
      console.warn(`[work-convergence] WorkItem anchor skipped for ${result.capsuleId}: ${error instanceof Error ? error.message : "unknown"}`);
    });
    const base = `Bound ${result.backlogItemId} to ${result.headBranch} (${result.capsuleId}).`;
    const conflicts = result.conflict
      ? [
          ...(result.conflict.backlogClaim ? [`${result.backlogItemId} already has an ACTIVE claim by another session; this call did NOT steal it`] : []),
          ...result.conflict.otherLocations.map((location) => `also in flight on ${location.headBranch ?? "?"} (${location.capsuleId})`),
        ]
      : [];
    return {
      success: true,
      entityId: result.capsuleId,
      message: conflicts.length
        ? `${base} ADVISORY: ${conflicts.join("; ")}. Coordinate before pushing.`
        : `${base} Claim-at-start recorded for this session.`,
      data: {
        ...result,
        workIntent: governed.data.workIntent,
        readiness: governed.data.readiness,
        readback: governed.data.readback,
      },
    };
  } catch (error) {
    if (error instanceof BacklogItemAlreadyClaimedError) {
      return {
        success: false,
        error: error.code,
        message: `${error.message} Reuse that Workroom, wait until it is no longer live, or deliberately co-claim with force=true and overrideReason.`,
        data: { backlogItemId: error.backlogItemId, liveWorkrooms: error.liveWorkrooms },
      };
    }
    const occupied = branchOccupiedResult(error);
    if (occupied) return occupied;
    const detail = error instanceof Error ? error.message : "Unknown failure";
    if (/not found/i.test(detail)) return { success: false, error: "not_found", message: detail };
    throw error;
  }
}
