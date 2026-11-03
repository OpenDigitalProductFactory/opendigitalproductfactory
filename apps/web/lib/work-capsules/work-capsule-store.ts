import { readDeliveryAgreement } from "@/lib/work-management/delivery-agreement";
import { randomUUID } from "node:crypto";
import { captureFiniteDeliveryState } from "./delivery-agreement-capture";
import { normalizePersistedScope, adoptionScopePatch, assertScopeReadback, scopeChangeEvidence, scopeWriteWhere } from "./scope-input";
import {
  STATUS_OVERRIDE_TTL_MS,
  buildCapsuleBranchName,
  buildCapsuleSlug,
  buildCapsuleWorktreePath,
  isRootClonePath,
  isAgentActivityKind,
  type AgentActivityKind,
  capsuleRepositoryFullName,
  isWorkCapsuleExecutorKind,
  isWorkCapsuleSource,
  isWorkCapsuleStatus,
  normalizeBranchTaxonomy,
  type WorkCapsuleBranchTaxonomy,
  type WorkCapsuleExecutorKind,
  type WorkCapsuleScopeInput,
  type WorkCapsuleSource,
  type WorkCapsuleStatus,
  buildWorkCapsuleScopeClaims,
} from "@/lib/work-capsules";
import { admitRuntimeGuardedWork } from "@/lib/platform-runtime/work-admission";
import { clearBuildPrDeliveryState } from "@/lib/build/build-pr-delivery-state";
import { assertWorkroomPublishable } from "./publication-refusal";
import { completeGovernedWorkCapsuleStatus } from "./work-capsule-terminal-status";
import { TERMINAL_WORKROOM_STATUSES } from "@/lib/work-management/standing-room-nesting";
import {
  CapsuleBranchOccupiedError,
  isReusableLiveCapsule,
  isTerminalCapsuleStatus,
  planTerminalCapsuleResume,
  planLiveCapsuleBinding,
  readBranchIdentityCapsule,
  defaultPlatformRepositoryFullName,
  type CapsuleAdoptionInput,
} from "./work-capsule-branch-identity";
import type { CapsuleDb, ClaimBacklogWorkspaceInput, WorkCapsuleActor } from "./work-capsule-store-types";
import { assertOAuthWorkroomOwner, workroomOwnershipData } from "./oauth-workroom-ownership";
import { recordWorkCapsuleActivity as recordActivity } from "./work-capsule-activity-store";
import {
  assertBacklogWorkroomClaimAvailable,
  loadBacklogWorkroomOwnership,
  lockBacklogItemForClaim,
} from "./backlog-workroom-ownership";

export type { CapsuleDb, WorkCapsuleActor } from "./work-capsule-store-types";
export { CapsuleBranchOccupiedError } from "./work-capsule-branch-identity";
export {
  WorkCapsuleCompletionDeniedError,
  WorkCapsulePublicationRefusedError,
} from "./work-capsule-terminal-status";
export { recordWorkCapsuleEvidence } from "./work-capsule-activity-store";
export { declareWorkCapsuleIntent } from "./work-capsule-intent-store";
export { heartbeatWorkCapsule, reassignWorkCapsuleExecutor } from "./workroom-lease";
export { releaseWorkCapsuleScope } from "./scope-release-store";
export { claimWorkCapsuleScope, detectScopeConflicts, ScopeOverlapError } from "./scope-claim-store";
export type { ScopeConflict } from "./scope-claim-store";

type CapsuleCreateInput = {
  title: string;
  objective: string;
  source: WorkCapsuleSource;
  idempotencyKey: string;
  executorKind?: WorkCapsuleExecutorKind | null;
  executorRef?: string | null;
  status?: WorkCapsuleStatus;
  /** Branch identity is (repositoryFullName, headBranch); null for a business capsule. */
  repositoryFullName?: string | null;
  backlogItemId?: string | null;
  epicId?: string | null;
  featureBuildId?: string | null;
  workspaceState?: Record<string, unknown>;
  acceptanceSource?: import("./delivery-agreement-capture").DeliveryAcceptanceSource;
  scope?: WorkCapsuleScopeInput | null;
  // BI-B24F96D0: principal who commissioned the work (Requester), distinct from
  // the creating actor. Optional.
  requestedByPrincipalId?: string | null;
};

type CapsuleWorkspacePlanInput = {
  capsuleId: string;
  taxonomy: WorkCapsuleBranchTaxonomy;
  os: NodeJS.Platform;
  home?: string;
  existingBranches: Set<string>;
  releaseOverride?: string;
};

function nextCapsuleId(): string {
  return `WC-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

async function inTransaction<T>(db: CapsuleDb, fn: (tx: CapsuleDb) => Promise<T>): Promise<T> {
  return db.$transaction ? db.$transaction(fn) : fn(db);
}

async function admitCapsuleWork(db: CapsuleDb, guard: `work-capsule:${string}`): Promise<void> {
  // CapsuleDb is intentionally usable by isolated domain tests. Production's
  // Prisma transaction supplies these three admission members.
  if (!db.$queryRaw || !db.platformCapability || !db.runtimeCapabilityTransition) return;
  await admitRuntimeGuardedWork(db as never, guard);
}

export async function createWorkCapsule(args: {
  db: CapsuleDb;
  input: CapsuleCreateInput;
  actor: WorkCapsuleActor;
}) {
  if (!isWorkCapsuleSource(args.input.source)) throw new Error("Invalid capsule source");
  if (args.input.executorKind && !isWorkCapsuleExecutorKind(args.input.executorKind)) {
    throw new Error("Invalid executor kind");
  }
  if (args.input.status && !isWorkCapsuleStatus(args.input.status)) {
    throw new Error("Invalid capsule status");
  }
  if (args.input.status === "complete") {
    throw new Error("Create the Work Capsule in a non-terminal state, then request governed completion");
  }
  const scope = normalizePersistedScope(args.input.scope);

  const existing = await args.db.workroom.findUnique({
    where: { idempotencyKey: args.input.idempotencyKey },
  });
  if (existing) { assertOAuthWorkroomOwner(existing, args.actor); assertScopeReadback(existing, args.input.scope); return existing; }

  const now = new Date();
  try {
    return await inTransaction(args.db, async (tx) => {
      const status = args.input.status ?? (args.input.executorKind ? "ready" : "draft");
      if (status !== "draft") await admitCapsuleWork(tx, `work-capsule:${args.input.source}`);
      const created = await tx.workroom.create({
        data: {
          capsuleId: nextCapsuleId(),
          title: args.input.title,
          objective: args.input.objective,
          source: args.input.source,
          executorKind: args.input.executorKind ?? null,
          executorRef: args.input.executorRef ?? null,
          repositoryFullName: capsuleRepositoryFullName(args.input.source, args.input.repositoryFullName, defaultPlatformRepositoryFullName, args.input.idempotencyKey),
          backlogItemId: args.input.backlogItemId ?? null,
          epicId: args.input.epicId ?? null,
          featureBuildId: args.input.featureBuildId ?? null,
          decisionScope: scope.decisionScope,
          portfolioRole: scope.portfolioRole,
          servedPersona: scope.servedPersona,
          activityKind: scope.activityKind,
          outcomeAnchor: scope.outcomeAnchor ?? {},
          servesPortfolioRoles: scope.servesPortfolioRoles,
          dependsOnPortfolioRoles: scope.dependsOnPortfolioRoles,
          // BI-8C54B216: convened WITH a shape. Rides scopeClaims (the home
          // workroom-shape-claim.ts reads) â€” no migration, invisible to readers.
          scopeClaims: buildWorkCapsuleScopeClaims(scope, now),
          workspaceState: await captureFiniteDeliveryState(tx, { ...args.input, activityKind: scope.activityKind, now }),
          idempotencyKey: args.input.idempotencyKey,
          ...workroomOwnershipData(args.actor, args.input.executorKind, now, args.input.requestedByPrincipalId),
          status,
        },
      });
      await recordActivity(tx, {
        workCapsuleId: created.id,
        kind: "created",
        summary: `Created Work Capsule ${created.capsuleId}`,
        payload: { deliveryAgreement: readDeliveryAgreement(created.workspaceState) },
        actor: args.actor,
      });
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const winner = await args.db.workroom.findUnique({
        where: { idempotencyKey: args.input.idempotencyKey },
      });
      if (winner) { assertOAuthWorkroomOwner(winner, args.actor); assertScopeReadback(winner, args.input.scope); return winner; }
    }
    throw error;
  }
}

export async function adoptWorktreeCapsule(args: {
  db: CapsuleDb;
  input: CapsuleAdoptionInput;
  actor: WorkCapsuleActor;
}) {
  if (args.input.executorKind && !isWorkCapsuleExecutorKind(args.input.executorKind)) {
    throw new Error("Invalid executor kind");
  }
  const scope = normalizePersistedScope(args.input.scope);

  const { existing, repositoryUnbound } = await readBranchIdentityCapsule(args.db, args.input);
  if (existing) assertOAuthWorkroomOwner(existing, args.actor);
  const now = new Date();
  const resumePlan = planTerminalCapsuleResume({ existing, input: args.input, actor: args.actor, now });
  if (resumePlan) {
    return inTransaction(args.db, async (tx) => {
      await admitCapsuleWork(tx, "work-capsule:external-adoption");
      const resumed = await tx.workroom.update({ where: scopeWriteWhere(existing!), data: {
        ...resumePlan.update.data, ...adoptionScopePatch(existing!, args.input.scope, now),
      } });
      await recordActivity(tx, { ...resumePlan.activity, payload: {
        ...resumePlan.activity.payload, scopeChanges: scopeChangeEvidence(existing!, resumed),
      }, actor: args.actor });
      return resumed;
    });
  }

  if (existing && isReusableLiveCapsule(existing, args.input)) {
    // Re-adoption advances supplied identity fields and preserves omitted scope.
    const binding = planLiveCapsuleBinding(existing, args.input);
    const repoBound = repositoryUnbound;
    const headSynced = Boolean(args.input.headSha) && args.input.headSha !== existing.headSha;
    const baseSynced = Boolean(args.input.baseSha) && args.input.baseSha !== existing.baseSha;
    const worktreeMoved = Boolean(args.input.worktreePath) && args.input.worktreePath !== existing.worktreePath;
    const scopePatch = adoptionScopePatch(existing, args.input.scope, now);
    if (Object.keys(scopePatch).length && existing.executorRef && existing.executorRef !== args.input.executorRef) {
      throw new CapsuleBranchOccupiedError(existing);
    }
    if (binding.changed || headSynced || baseSynced || repoBound || worktreeMoved || Object.keys(scopePatch).length) {
      const bound = await inTransaction(args.db, async (tx) => {
        const updated = await tx.workroom.update({
          where: { ...scopeWriteWhere(existing), ...binding.where },
          data: {
            ...scopePatch,
            ...binding.data,
            ...(worktreeMoved ? { worktreePath: args.input.worktreePath } : {}),
            ...(repoBound ? { repositoryFullName: args.input.repositoryFullName } : {}),
            ...(headSynced ? { headSha: args.input.headSha, pullRequestNumber: null, pullRequestUrl: null,
              workspaceState: clearBuildPrDeliveryState(existing.workspaceState) } : {}),
            ...(baseSynced ? { baseSha: args.input.baseSha } : {}),
            ...(headSynced || baseSynced ? { lastSyncedAt: now } : {}),
          },
        });
        await recordActivity(tx, {
          workCapsuleId: existing.id,
          kind: "adopted",
          summary: binding.backlogBound ? `Late-bound ${existing.capsuleId} to ${args.input.backlogItemId}`
            : repoBound ? `Bound ${existing.capsuleId} to ${args.input.repositoryFullName} for ${args.input.headBranch}`
            : `Synced ${existing.capsuleId} branch state for ${args.input.headBranch}`,
          payload: {
            scopeChanges: scopeChangeEvidence(existing, updated),
            ...binding.evidence,
            ...(repoBound ? { repositoryFullName: args.input.repositoryFullName, repositoryLateBind: true } : {}),
            ...(worktreeMoved ? { worktreePath: args.input.worktreePath, previousWorktreePath: existing.worktreePath ?? null } : {}),
            ...(headSynced ? { headSha: args.input.headSha, previousHeadSha: existing.headSha ?? null,
              previousPullRequestNumber: existing.pullRequestNumber ?? null, previousPullRequestUrl: existing.pullRequestUrl ?? null } : {}),
            ...(baseSynced ? { baseSha: args.input.baseSha, previousBaseSha: existing.baseSha ?? null } : {}),
          },
          actor: args.actor,
        });
        return updated;
      });
      return bound;
    }
    return existing;
  }
  if (existing) {
    throw new CapsuleBranchOccupiedError(existing);
  }

  try {
    return await inTransaction(args.db, async (tx) => {
      await admitCapsuleWork(tx, "work-capsule:external-adoption");
      const capsule = await tx.workroom.create({
        data: {
          capsuleId: nextCapsuleId(),
          title: args.input.title,
          objective: args.input.objective,
          source: "external-adoption",
          workspaceState: await captureFiniteDeliveryState(tx, { ...args.input, source: "external-adoption", now }),
          status: "ready",
          executorKind: args.input.executorKind ?? null,
          executorRef: args.input.executorRef ?? null,
          backlogItemId: args.input.backlogItemId ?? null,
          epicId: args.input.epicId ?? null,
          repositoryFullName: args.input.repositoryFullName,
          baseBranch: args.input.baseBranch ?? "main",
          baseSha: args.input.baseSha ?? null,
          headBranch: args.input.headBranch,
          headSha: args.input.headSha ?? null,
          worktreePath: args.input.worktreePath,
          branchTaxonomy: normalizeBranchTaxonomy(args.input.headBranch),
          scopeClaims: buildWorkCapsuleScopeClaims(scope, now),
          decisionScope: scope.decisionScope,
          portfolioRole: scope.portfolioRole,
          servedPersona: scope.servedPersona,
          activityKind: scope.activityKind,
          outcomeAnchor: scope.outcomeAnchor ?? {},
          servesPortfolioRoles: scope.servesPortfolioRoles,
          dependsOnPortfolioRoles: scope.dependsOnPortfolioRoles,
          ...workroomOwnershipData(args.actor, args.input.executorKind, now),
          lastSyncedAt: now,
        },
      });
      await recordActivity(tx, {
        workCapsuleId: capsule.id,
        kind: "adopted",
        summary: `Adopted ${args.input.headBranch}`,
        payload: { worktreePath: args.input.worktreePath, deliveryAgreement: readDeliveryAgreement(capsule.workspaceState) },
        actor: args.actor,
      });
      return capsule;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const winner = await args.db.workroom.findFirst({
        where: {
          repositoryFullName: args.input.repositoryFullName,
          headBranch: args.input.headBranch,
        },
        orderBy: { updatedAt: "desc" },
      });
      if (winner && isReusableLiveCapsule(winner, args.input)) {
        assertOAuthWorkroomOwner(winner, args.actor);
        assertScopeReadback(winner, args.input.scope);
        return winner;
      }
      if (winner) throw new CapsuleBranchOccupiedError(winner);
    }
    throw error;
  }
}

export type BacklogWorkspaceConflict = {
  backlogClaim: null;
  otherLocations: Array<{
    capsuleId: string;
    headBranch: string | null;
    worktreePath: string | null;
    executorRef: string | null;
    leaseHolderPrincipalId: string | null;
  }>;
};

/** Bind existing backlog work to this source identity without overwriting a live owner. */
export async function claimBacklogItemWorkspace(args: {
  db: CapsuleDb;
  input: ClaimBacklogWorkspaceInput;
  actor: WorkCapsuleActor;
  now?: Date;
}): Promise<{
  capsuleId: string;
  backlogItemId: string;
  headBranch: string;
  worktreePath: string;
  claimed: boolean;
  conflict: BacklogWorkspaceConflict | null;
}> {
  if (!args.db.backlogItem) {
    throw new Error("claimBacklogItemWorkspace requires a db with backlogItem access");
  }
  const now = args.now ?? new Date();

  // Resolve the BacklogItem by semantic itemId (BI-*) or cuid; fail clearly if absent.
  const item = await args.db.backlogItem.findFirst({
    where: { OR: [{ itemId: args.input.backlogItemId }, { id: args.input.backlogItemId }] },
    select: {
      id: true,
      itemId: true,
      epicId: true, title: true, body: true, outcome: true,
      claimStatus: true,
      claimedById: true,
      claimedByAgentId: true,
      claimedAt: true,
    },
  });
  if (!item) {
    throw new Error(`BacklogItem ${args.input.backlogItemId} not found`);
  }

  await lockBacklogItemForClaim(args.db, item.id);
  const ownershipDb = {
    workroom: args.db.workroom,
    featureBuild: args.db.featureBuild ?? { findMany: async () => [] },
    ...(args.db.nonProductionEnvironmentLease
      ? { nonProductionEnvironmentLease: args.db.nonProductionEnvironmentLease }
      : {}),
  };
  const ownership = await loadBacklogWorkroomOwnership(
    ownershipDb,
    [item.itemId, item.id],
    now,
  );
  const admission = assertBacklogWorkroomClaimAvailable({
    backlogItemId: item.itemId,
    liveWorkrooms: ownership.liveWorkrooms,
    repositoryFullName: args.input.repositoryFullName,
    headBranch: args.input.headBranch,
    force: args.input.force === true,
    overrideReason: args.input.overrideReason ?? null,
  });

  // Create or reuse+late-bind the capsule bound to BI + location + session.
  const capsule = await adoptWorktreeCapsule({
    db: args.db,
    input: {
      title: args.input.title ?? `Work on ${item.itemId}`,
      // BI-8DE5429B (WWMD DI-139981F74A44): the room's outcome is the item's.
      objective: args.input.objective ?? item.outcome ?? item.title ?? `Claim-at-start binding for ${item.itemId}`,
      acceptanceSource: { itemId: item.itemId, body: item.body ?? null },
      repositoryFullName: args.input.repositoryFullName,
      headBranch: args.input.headBranch,
      worktreePath: args.input.worktreePath,
      baseBranch: args.input.baseBranch ?? "main",
      baseSha: args.input.baseSha ?? null,
      headSha: args.input.headSha ?? null,
      backlogItemId: item.itemId,
      epicId: item.epicId ?? null,
      executorKind: args.input.executorKind ?? null,
      executorRef: args.input.executorRef ?? null,
    },
    actor: args.actor,
  });

  const claimed = admission.overrideConflicts.length === 0;
  if (claimed) {
    await args.db.backlogItem.update({
      where: { id: item.id },
      data: {
        claimStatus: "active",
        claimedById: args.actor.userId,
        claimedByAgentId: args.actor.agentId,
        claimedAt: now,
      },
    });
  }
  if (admission.overrideConflicts.length > 0) {
    await args.db.workroomActivity.create({
      data: {
        workCapsuleId: capsule.id,
        kind: "backlog-claim-override",
        summary: `Deliberately co-claimed ${item.itemId}: ${args.input.overrideReason!.trim()}`,
        payload: { reason: args.input.overrideReason!.trim(), liveWorkrooms: admission.overrideConflicts },
        recordedById: args.actor.userId,
        recordedByAgentId: args.actor.agentId,
      },
    });
  }
  const conflict: BacklogWorkspaceConflict | null = admission.overrideConflicts.length > 0 ? {
    backlogClaim: null,
    otherLocations: admission.overrideConflicts.map((room) => ({
      capsuleId: room.capsuleId, headBranch: room.headBranch, worktreePath: room.worktreePath,
      executorRef: room.executorRef, leaseHolderPrincipalId: room.leaseHolderPrincipalId,
    })),
  } : null;

  return {
    capsuleId: capsule.capsuleId,
    backlogItemId: item.itemId,
    headBranch: capsule.headBranch ?? args.input.headBranch,
    worktreePath: capsule.worktreePath ?? args.input.worktreePath,
    claimed,
    conflict,
  };
}

async function hasWorkspaceCollision(
  db: CapsuleDb,
  args: { capsuleId: string; headBranch: string; worktreePath: string },
): Promise<boolean> {
  const existing = await db.workroom.findFirst({
    where: {
      capsuleId: { not: args.capsuleId },
      archivedAt: null,
      OR: [
        { headBranch: args.headBranch },
        { worktreePath: args.worktreePath },
      ],
    },
    select: { id: true },
  });
  return Boolean(existing);
}

export async function planCapsuleWorkspace(args: {
  db: CapsuleDb;
  input?: CapsuleWorkspacePlanInput;
  capsuleId?: string;
  taxonomy?: WorkCapsuleBranchTaxonomy;
  os?: NodeJS.Platform;
  home?: string;
  existingBranches?: Set<string>;
  releaseOverride?: string;
  actor: WorkCapsuleActor;
}) {
  const input: CapsuleWorkspacePlanInput = args.input ?? {
    capsuleId: args.capsuleId ?? "",
    taxonomy: args.taxonomy as WorkCapsuleBranchTaxonomy,
    os: args.os ?? process.platform,
    home: args.home,
    existingBranches: args.existingBranches ?? new Set<string>(),
    releaseOverride: args.releaseOverride,
  };

  const capsule = await args.db.workroom.findUnique({
    where: { capsuleId: input.capsuleId },
  });
  if (!capsule) throw new Error(`Work Capsule ${input.capsuleId} not found`);

  if (capsule.headBranch && capsule.worktreePath) return capsule;
  if (capsule.headBranch || capsule.worktreePath) {
    throw new Error(
      `Work Capsule ${input.capsuleId} is in a partial-plan state ` +
        `(headBranch=${capsule.headBranch ?? "null"}, worktreePath=${capsule.worktreePath ?? "null"}). ` +
        "Repair the row before re-planning.",
    );
  }

  const baseSlug = buildCapsuleSlug(capsule.title, capsule.capsuleId);
  let slug = baseSlug;
  let headBranch = buildCapsuleBranchName({ taxonomy: input.taxonomy, slug });
  let worktreePath = buildCapsuleWorktreePath({ os: input.os, slug, home: input.home });
  let suffix = 2;

  while (
    input.existingBranches.has(headBranch) ||
    await hasWorkspaceCollision(args.db, { capsuleId: input.capsuleId, headBranch, worktreePath })
  ) {
    slug = `${baseSlug}-${suffix}`;
    headBranch = buildCapsuleBranchName({ taxonomy: input.taxonomy, slug });
    worktreePath = buildCapsuleWorktreePath({ os: input.os, slug, home: input.home });
    suffix += 1;
    if (suffix > 99) throw new Error("Could not allocate a unique branch name within 99 attempts");
  }

  if (isRootClonePath(worktreePath, input.os, input.home, input.releaseOverride)) {
    throw new Error("Refusing to plan the root clone as an active workspace");
  }

  return inTransaction(args.db, async (tx) => {
    const updated = await tx.workroom.update({
      where: { capsuleId: input.capsuleId },
      data: {
        headBranch,
        worktreePath,
        branchTaxonomy: input.taxonomy,
        baseBranch: capsule.baseBranch ?? "main",
        // Planning IS the moment a capsule acquires branch identity (BI-F83CF689).
        repositoryFullName: capsule.repositoryFullName ?? defaultPlatformRepositoryFullName(),
        status: capsule.status === "draft" ? "ready" : capsule.status,
      },
    });
    await recordActivity(tx, {
      workCapsuleId: capsule.id,
      kind: "workspace-planned",
      summary: `Planned ${headBranch} at ${worktreePath}`,
      payload: { headBranch, worktreePath, branchTaxonomy: input.taxonomy, repositoryFullName: updated.repositoryFullName },
      actor: args.actor,
    });
    return updated;
  });
}



/**
 * Emit a human-legible agent-session activity (thought / action / question /
 * response / error) onto the Workroom's timeline (BI-C41AB195). The capsule
 * IS the teammate session; every executor and sub-worker writes to the SAME
 * capsule via this one writer, so multi-agent work rolls up into one feed on one
 * item rather than N separate surfaces. `payload.subtaskRef` (optional) lets a
 * sub-worker line be attributed without a separate session record.
 */
export async function recordAgentActivity(args: {
  db: CapsuleDb;
  capsuleId: string;
  activity: {
    type: AgentActivityKind;
    body: string;
    payload?: Record<string, unknown>;
  };
  actor: WorkCapsuleActor;
}) {
  if (!isAgentActivityKind(args.activity.type)) {
    throw new Error("Invalid agent activity type");
  }

  const capsule = await args.db.workroom.findUnique({
    where: { capsuleId: args.capsuleId },
  });
  if (!capsule) throw new Error(`Work Capsule ${args.capsuleId} not found`);
  return recordActivity(args.db, {
    workCapsuleId: capsule.id,
    kind: args.activity.type,
    summary: args.activity.body,
    payload: args.activity.payload ?? {},
    actor: args.actor,
  });
}

export async function updateWorkCapsuleStatus(args: {
  db: CapsuleDb;
  capsuleId: string;
  status: WorkCapsuleStatus;
  reason: string;
  actor: WorkCapsuleActor;
  now?: Date;
}) {
  if (!isWorkCapsuleStatus(args.status)) throw new Error("Invalid capsule status");

  const capsule = await args.db.workroom.findUnique({
    where: { capsuleId: args.capsuleId },
  });
  if (!capsule) throw new Error(`Work Capsule ${args.capsuleId} not found`);

  const hasGovernedLink = Boolean(capsule.backlogItemId || capsule.featureBuildId || capsule.taskRunId);
  await assertWorkroomPublishable({ ...capsule, capsuleId: args.capsuleId, status: args.status, backlogItem: args.db.backlogItem });
  if (args.status === "complete" && hasGovernedLink) {
    const completed = await completeGovernedWorkCapsuleStatus({
      db: args.db,
      capsuleId: args.capsuleId,
      expectedStatus: capsule.status,
      reason: args.reason,
      actor: args.actor,
      evaluatedAt: (args.now ?? new Date()).toISOString(),
    });
    await closeEndedRoomSteps(args, capsule.status);
    return completed;
  }

  const currentWorkspaceState =
    capsule.workspaceState && typeof capsule.workspaceState === "object" && !Array.isArray(capsule.workspaceState)
      ? capsule.workspaceState as Record<string, unknown>
      : {};
  const now = args.now ?? new Date();
  const statusOverride = {
    reason: args.reason,
    until: new Date(now.getTime() + STATUS_OVERRIDE_TTL_MS).toISOString(),
  };

  const updated = await inTransaction(args.db, async (tx) => {
    const updated = await tx.workroom.update({
      where: { capsuleId: args.capsuleId },
      data: {
        status: args.status,
        workspaceState: {
          ...currentWorkspaceState,
          statusOverride,
        },
      },
    });
    await recordActivity(tx, {
      workCapsuleId: capsule.id,
      kind: "status-override",
      summary: args.reason,
      payload: { status: args.status, statusOverride },
      actor: args.actor,
    });
    return updated;
  });
  await closeEndedRoomSteps({ ...args, now }, capsule.status);
  return updated;
}

/**
 * A room that ends stops being driven, so nothing else closes its open steps
 * (BI-C9F1DE01). Close them once the status is committed. Inside a caller's
 * transaction the commit is not ours to see; the hourly reconciliation in the
 * queue metrics aggregator closes those instead.
 */
async function closeEndedRoomSteps(args: { db: CapsuleDb; capsuleId: string; status: string; now?: Date }, priorStatus: string) {
  if (!TERMINAL_WORKROOM_STATUSES.has(args.status) || TERMINAL_WORKROOM_STATUSES.has(priorStatus)) return;
  if (!("$transaction" in args.db)) return;
  const { closeStageTelemetryForEndedRoom } = await import("@/lib/work-management/workroom-stage-telemetry");
  await closeStageTelemetryForEndedRoom(args.capsuleId, args.now ?? new Date());
}
