import { randomUUID } from "node:crypto";
import {
  STATUS_OVERRIDE_TTL_MS,
  buildCapsuleBranchName,
  buildCapsuleSlug,
  buildCapsuleWorktreePath,
  isRootClonePath,
  isWorkCapsuleEvidenceKind,
  isAgentActivityKind,
  type AgentActivityKind,
  isWorkCapsuleExecutorKind,
  isWorkCapsuleSource,
  isWorkCapsuleStatus,
  normalizeBranchTaxonomy,
  normalizeWorkCapsuleScopeInput,
  parseScopeClaims,
  type ScopeClaim,
  type WorkCapsuleBranchTaxonomy,
  type WorkCapsuleEvidenceKind,
  type WorkCapsuleExecutorKind,
  type WorkCapsuleScopeInput,
  type WorkCapsuleSource,
  type WorkCapsuleStatus,
} from "@/lib/work-capsules";
import { admitRuntimeGuardedWork } from "@/lib/platform-runtime/work-admission";
import { planCapsuleChangeImpact, type CapsuleChangeImpactContract } from "./change-impact-contract";
import { completeGovernedWorkCapsuleStatus } from "./work-capsule-terminal-status";
import {
  CapsuleBranchOccupiedError,
  isExternalLeaseExecutor,
  isReusableLiveCapsule,
  isTerminalCapsuleStatus,
  leaseUntil,
  planTerminalCapsuleResume,
  readBranchIdentityCapsule,
  TERMINAL_CAPSULE_STATUSES,
  defaultPlatformRepositoryFullName,
  type CapsuleAdoptionInput,
} from "./work-capsule-branch-identity";
import type { CapsuleDb, WorkCapsuleActor } from "./work-capsule-store-types";
import { recordWorkCapsuleActivity as recordActivity } from "./work-capsule-activity-store";
import { intentsConflict, scopeValuesOverlap } from "./work-capsule-scope-overlap";

export type { CapsuleDb, WorkCapsuleActor } from "./work-capsule-store-types";
export { CapsuleBranchOccupiedError } from "./work-capsule-branch-identity";
export { WorkCapsuleCompletionDeniedError } from "./work-capsule-terminal-status";
export { declareWorkCapsuleIntent } from "./work-capsule-intent-store";

type CapsuleCreateInput = {
  title: string;
  objective: string;
  source: WorkCapsuleSource;
  idempotencyKey: string;
  executorKind?: WorkCapsuleExecutorKind | null;
  executorRef?: string | null;
  status?: WorkCapsuleStatus;
  /** Keyed branch identity is (repositoryFullName, headBranch) — never null (BI-F83CF689). */
  repositoryFullName?: string | null;
  backlogItemId?: string | null;
  epicId?: string | null;
  featureBuildId?: string | null;
  workspaceState?: Record<string, unknown>;
  scope?: WorkCapsuleScopeInput | null;
  // BI-B24F96D0: principal who commissioned the work (Requester), distinct from
  // the creating actor. Optional.
  requestedByPrincipalId?: string | null;
};

type CapsuleEvidenceInput = {
  kind: WorkCapsuleEvidenceKind;
  summary: string;
  command?: string;
  url?: string;
  targetId?: string;
  runtimeTargetId?: string;
  verificationId?: string;
  result?: unknown;
};

type ScopeClaimInput = Pick<ScopeClaim, "kind" | "value" | "intent">;
type ScopeReleaseInput = Pick<ScopeClaim, "kind" | "value">;

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
  const scope = normalizeWorkCapsuleScopeInput(args.input.scope);

  const existing = await args.db.workroom.findUnique({
    where: { idempotencyKey: args.input.idempotencyKey },
  });
  if (existing) return existing;

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
          repositoryFullName: args.input.repositoryFullName?.trim() || defaultPlatformRepositoryFullName(),
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
          // workroom-shape-claim.ts reads) — no migration, invisible to readers.
          scopeClaims: scope.workroomShape
            ? [{ workroomShape: scope.workroomShape, recordedAt: now.toISOString() }]
            : [],
          workspaceState: args.input.workspaceState ?? {},
          idempotencyKey: args.input.idempotencyKey,
          leaseHolderPrincipalId: isExternalLeaseExecutor(args.input.executorKind)
            ? args.actor.principalId
            : null,
          leaseExpiresAt: isExternalLeaseExecutor(args.input.executorKind) ? leaseUntil(now) : null,
          createdByPrincipalId: args.actor.principalId,
          requestedByPrincipalId: args.input.requestedByPrincipalId ?? null,
          status,
        },
      });
      await recordActivity(tx, {
        workCapsuleId: created.id,
        kind: "created",
        summary: `Created Work Capsule ${created.capsuleId}`,
        actor: args.actor,
      });
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const winner = await args.db.workroom.findUnique({
        where: { idempotencyKey: args.input.idempotencyKey },
      });
      if (winner) return winner;
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
  const scope = normalizeWorkCapsuleScopeInput(args.input.scope);

  const { existing, repositoryUnbound } = await readBranchIdentityCapsule(args.db, args.input);

  const now = new Date();
  const resumePlan = planTerminalCapsuleResume({ existing, input: args.input, actor: args.actor, now });
  if (resumePlan) {
    return inTransaction(args.db, async (tx) => {
      await admitCapsuleWork(tx, "work-capsule:external-adoption");
      const resumed = await tx.workroom.update(resumePlan.update);
      await recordActivity(tx, { ...resumePlan.activity, actor: args.actor });
      return resumed;
    });
  }

  if (existing && isReusableLiveCapsule(existing, args.input)) {
    // Late-bind (BI-7D20BFDF): a branch adopted before its BacklogItem was known
    // has a null backlogItemId. When a claim now supplies one, bind the existing
    // capsule instead of leaving the work orphaned — this is what lets a worktree
    // cut before the BI was chosen still join the BI↔location record.
    const lateBind = Boolean(args.input.backlogItemId) && existing.backlogItemId == null;
    // BI-F83CF689: bind the repository onto a capsule that predates the
    // create/plan default, so its branch identity becomes keyed and the next
    // caller matches it directly.
    const repoBound = repositoryUnbound;
    // Head sync (BI-B9403248): headSha used to be written only on CREATE, so a
    // capsule adopted or claimed before the artifact commit existed could never
    // satisfy the plan-coverage ownership check, and any amend/rebase/squash
    // after adoption stranded it for good. The branch head is the caller's own
    // state, not privileged data, so re-adopting the same branch advances it.
    const headSynced = Boolean(args.input.headSha) && args.input.headSha !== existing.headSha;
    const baseSynced = Boolean(args.input.baseSha) && args.input.baseSha !== existing.baseSha;
    if (lateBind || headSynced || baseSynced || repoBound) {
      const bound = await inTransaction(args.db, async (tx) => {
        const updated = await tx.workroom.update({
          where: { capsuleId: existing.capsuleId },
          data: {
            ...(lateBind
              ? {
                backlogItemId: args.input.backlogItemId,
                ...(args.input.epicId && existing.epicId == null ? { epicId: args.input.epicId } : {}),
                ...(args.input.executorRef && existing.executorRef == null ? { executorRef: args.input.executorRef } : {}),
                ...(args.input.worktreePath && existing.worktreePath !== args.input.worktreePath ? { worktreePath: args.input.worktreePath } : {}),
              }
              : {}),
            ...(repoBound ? { repositoryFullName: args.input.repositoryFullName } : {}),
            ...(headSynced ? { headSha: args.input.headSha } : {}),
            ...(baseSynced ? { baseSha: args.input.baseSha } : {}),
            ...(headSynced || baseSynced ? { lastSyncedAt: now } : {}),
          },
        });
        await recordActivity(tx, {
          workCapsuleId: existing.id,
          kind: "adopted",
          summary: lateBind ? `Late-bound ${existing.capsuleId} to ${args.input.backlogItemId}`
            : repoBound ? `Bound ${existing.capsuleId} to ${args.input.repositoryFullName} for ${args.input.headBranch}`
            : `Synced ${existing.capsuleId} branch state for ${args.input.headBranch}`,
          payload: {
            ...(lateBind ? { backlogItemId: args.input.backlogItemId, lateBind: true } : {}),
            ...(repoBound ? { repositoryFullName: args.input.repositoryFullName, repositoryLateBind: true } : {}),
            ...(headSynced ? { headSha: args.input.headSha, previousHeadSha: existing.headSha ?? null } : {}),
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
          decisionScope: scope.decisionScope,
          portfolioRole: scope.portfolioRole,
          servedPersona: scope.servedPersona,
          activityKind: scope.activityKind,
          outcomeAnchor: scope.outcomeAnchor ?? {},
          servesPortfolioRoles: scope.servesPortfolioRoles,
          dependsOnPortfolioRoles: scope.dependsOnPortfolioRoles,
          leaseHolderPrincipalId: isExternalLeaseExecutor(args.input.executorKind)
            ? args.actor.principalId
            : null,
          leaseExpiresAt: isExternalLeaseExecutor(args.input.executorKind) ? leaseUntil(now) : null,
          createdByPrincipalId: args.actor.principalId,
          lastSyncedAt: now,
        },
      });
      await recordActivity(tx, {
        workCapsuleId: capsule.id,
        kind: "adopted",
        summary: `Adopted ${args.input.headBranch}`,
        payload: { worktreePath: args.input.worktreePath },
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
      if (winner && isReusableLiveCapsule(winner, args.input)) return winner;
      if (winner) throw new CapsuleBranchOccupiedError(winner);
    }
    throw error;
  }
}

// A claim older than this is treated as abandoned (a dead session) and is
// reclaimable — mirrors STALE_BACKLOG_CLAIM_MS in the direct-build claim gate
// (mcp-tools.ts triage_backlog_item / status→in-progress). REUSE, do not diverge.
const STALE_BACKLOG_CLAIM_MS = 12 * 60 * 60 * 1000;

/**
 * A NON-blocking conflict surfaced by claimBacklogItemWorkspace. The soft
 * claim-at-start binds the capsule regardless; this metadata advises the caller
 * that other active work already exists so it can coordinate (it is NOT a lock).
 */
export type BacklogWorkspaceConflict = {
  /** The BacklogItem already carries a fresh active claim held by another session. */
  backlogClaim: {
    claimedById: string | null;
    claimedByAgentId: string | null;
    claimedAt: Date | null;
    claimAgeMinutes: number | null;
  } | null;
  /** Other non-archived capsules on the same BI, on a DIFFERENT branch/session. */
  otherLocations: Array<{
    capsuleId: string;
    headBranch: string | null;
    worktreePath: string | null;
    executorRef: string | null;
    leaseHolderPrincipalId: string | null;
  }>;
};

/**
 * Soft claim-at-start (BI-7D20BFDF): bind a BacklogItem to the location + session
 * that is starting work on it, so a directly-working agent's BI no longer looks
 * unclaimed to a parallel session. Creates (or reuses + late-binds) the
 * Workroom for (repositoryFullName, headBranch) and stamps the BI claim
 * fields, FOLLOWING the existing 12h-stale claim convention.
 *
 * This is advisory, not a hard lock (per the WWMD kernel decision): an existing
 * FRESH claim held by a DIFFERENT agent/session is NOT overwritten and is
 * returned as a non-blocking `conflict` — but the capsule is still bound so the
 * work is tracked. Multiple capsules per BI (one per branch) are expected and are
 * NOT themselves a conflict.
 */
export async function claimBacklogItemWorkspace(args: {
  db: CapsuleDb;
  input: {
    backlogItemId: string;
    repositoryFullName: string;
    headBranch: string;
    worktreePath: string;
    baseBranch?: string | null;
    executorKind?: WorkCapsuleExecutorKind | null;
    executorRef?: string | null;
    title?: string;
    objective?: string;
  };
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
      epicId: true,
      claimStatus: true,
      claimedById: true,
      claimedByAgentId: true,
      claimedAt: true,
    },
  });
  if (!item) {
    throw new Error(`BacklogItem ${args.input.backlogItemId} not found`);
  }

  // Create or reuse+late-bind the capsule bound to BI + location + session.
  const capsule = await adoptWorktreeCapsule({
    db: args.db,
    input: {
      title: args.input.title ?? `Work on ${item.itemId}`,
      objective: args.input.objective ?? `Claim-at-start binding for ${item.itemId}`,
      repositoryFullName: args.input.repositoryFullName,
      headBranch: args.input.headBranch,
      worktreePath: args.input.worktreePath,
      baseBranch: args.input.baseBranch ?? "main",
      backlogItemId: item.itemId,
      epicId: item.epicId ?? null,
      executorKind: args.input.executorKind ?? null,
      executorRef: args.input.executorRef ?? null,
    },
    actor: args.actor,
  });

  // Conflict 1: the BI already carries a FRESH active claim held by a different
  // session. Do NOT overwrite it (soft claim) — surface it as advisory.
  const claimAgeMs = item.claimedAt ? now.getTime() - new Date(item.claimedAt).getTime() : Infinity;
  const claimIsFresh = claimAgeMs < STALE_BACKLOG_CLAIM_MS;
  const ownedByCaller =
    (item.claimedById != null && item.claimedById === args.actor.userId) ||
    (item.claimedByAgentId != null && item.claimedByAgentId === args.actor.agentId);
  const activelyClaimedByOther =
    item.claimStatus === "active" &&
    claimIsFresh &&
    !ownedByCaller &&
    (item.claimedById != null || item.claimedByAgentId != null);

  // Conflict 2: another non-archived capsule on the SAME BI, on a different branch
  // or session. Multiple branches per BI are fine, but we still list them so the
  // caller can see the parallel work.
  const otherCapsules = await args.db.workroom.findMany({
    where: {
      backlogItemId: item.itemId,
      archivedAt: null,
      capsuleId: { not: capsule.capsuleId },
    },
    select: {
      capsuleId: true,
      headBranch: true,
      worktreePath: true,
      executorRef: true,
      leaseHolderPrincipalId: true,
    },
  });

  let claimed = false;
  if (!activelyClaimedByOther) {
    // Acquire (or refresh) the BI claim for this session — the stale/self case.
    await args.db.backlogItem.update({
      where: { id: item.id },
      data: {
        claimStatus: "active",
        claimedById: args.actor.userId,
        claimedByAgentId: args.actor.agentId,
        claimedAt: now,
      },
    });
    claimed = true;
  }

  const hasConflict = activelyClaimedByOther || (otherCapsules?.length ?? 0) > 0;
  const conflict: BacklogWorkspaceConflict | null = hasConflict
    ? {
        backlogClaim: activelyClaimedByOther
          ? {
              claimedById: item.claimedById,
              claimedByAgentId: item.claimedByAgentId,
              claimedAt: item.claimedAt ?? null,
              claimAgeMinutes: Number.isFinite(claimAgeMs) ? Math.round(claimAgeMs / 60000) : null,
            }
          : null,
        otherLocations: (otherCapsules ?? []).map((c) => ({
          capsuleId: c.capsuleId,
          headBranch: c.headBranch ?? null,
          worktreePath: c.worktreePath ?? null,
          executorRef: c.executorRef ?? null,
          leaseHolderPrincipalId: c.leaseHolderPrincipalId ?? null,
        })),
      }
    : null;

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

export async function heartbeatWorkCapsule(args: {
  db: CapsuleDb;
  capsuleId: string;
  actor: WorkCapsuleActor;
  now?: Date;
}) {
  const nextLease = leaseUntil(args.now ?? new Date());
  return inTransaction(args.db, async (tx) => {
    const capsule = await tx.workroom.update({
      where: { capsuleId: args.capsuleId },
      data: {
        leaseHolderPrincipalId: args.actor.principalId,
        leaseExpiresAt: nextLease,
      },
    });
    await recordActivity(tx, {
      workCapsuleId: capsule.id,
      kind: "lease-renewed",
      summary: `Lease renewed until ${nextLease.toISOString()}`,
      actor: args.actor,
    });
    return capsule;
  });
}

/**
 * Cross-agent handoff (EP-WORK-CONVERGENCE / BI-A443B9CC): change the capsule's
 * executor, transfer the lease to the receiving principal, and record an
 * `executor-changed` activity carrying the full provenance + handoff manifest
 * (from/to executor, lease transfer, reason, next action / open risks / evidence
 * digest). This is the writer for the `executor-changed` activity kind, which
 * previously had zero writers. Renders as "Claude started this; Grok is
 * finishing it" — a plain status event, not raw agent plumbing.
 */
export async function reassignWorkCapsuleExecutor(args: {
  db: CapsuleDb;
  capsuleId: string;
  toExecutorKind: WorkCapsuleExecutorKind;
  toExecutorRef?: string | null;
  /** The receiving/acting principal — becomes the new lease holder. */
  actor: WorkCapsuleActor;
  reason?: string;
  /** next action, open risks, evidence digest, branch/worktree, suggested receiver. */
  handoffManifest?: Record<string, unknown>;
  now?: Date;
}) {
  if (!isWorkCapsuleExecutorKind(args.toExecutorKind)) {
    throw new Error("Invalid executor kind");
  }
  const nextLease = leaseUntil(args.now ?? new Date());
  return inTransaction(args.db, async (tx) => {
    const current = await tx.workroom.findUnique({
      where: { capsuleId: args.capsuleId },
      select: {
        id: true,
        executorKind: true,
        executorRef: true,
        leaseHolderPrincipalId: true,
      },
    });
    if (!current) throw new Error(`Work Capsule ${args.capsuleId} not found`);

    const updated = await tx.workroom.update({
      where: { capsuleId: args.capsuleId },
      data: {
        executorKind: args.toExecutorKind,
        executorRef: args.toExecutorRef ?? null,
        leaseHolderPrincipalId: args.actor.principalId,
        leaseExpiresAt: nextLease,
      },
    });

    await recordActivity(tx, {
      workCapsuleId: updated.id,
      kind: "executor-changed",
      summary: `Executor changed ${current.executorKind ?? "none"} → ${args.toExecutorKind}${args.reason ? `: ${args.reason}` : ""}`,
      payload: {
        fromExecutorKind: current.executorKind ?? null,
        fromExecutorRef: current.executorRef ?? null,
        toExecutorKind: args.toExecutorKind,
        toExecutorRef: args.toExecutorRef ?? null,
        fromLeaseHolderPrincipalId: current.leaseHolderPrincipalId ?? null,
        toLeaseHolderPrincipalId: args.actor.principalId,
        reason: args.reason ?? null,
        handoffManifest: args.handoffManifest ?? null,
      },
      actor: args.actor,
    });
    return updated;
  });
}

export async function recordWorkCapsuleEvidence(args: {
  db: CapsuleDb;
  capsuleId: string;
  evidence: CapsuleEvidenceInput;
  actor: WorkCapsuleActor;
}) {
  if (!isWorkCapsuleEvidenceKind(args.evidence.kind)) {
    throw new Error("Invalid evidence kind");
  }

  const capsule = await args.db.workroom.findUnique({
    where: { capsuleId: args.capsuleId },
  });
  if (!capsule) throw new Error(`Work Capsule ${args.capsuleId} not found`);

  return recordActivity(args.db, {
    workCapsuleId: capsule.id,
    kind: "evidence-recorded",
    summary: args.evidence.summary,
    payload: args.evidence,
    actor: args.actor,
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

/**
 * A scope claim on another active capsule that conflicts with an incoming
 * claim — same `kind:value`, with at least one side claiming `edit` intent.
 */
export type ScopeConflict = {
  capsuleId: string;
  title: string;
  kind: ScopeClaim["kind"];
  value: string;
  existingIntent: ScopeClaim["intent"];
  incomingIntent: ScopeClaim["intent"];
  leaseHolderPrincipalId: string | null;
};

/**
 * Thrown by claimWorkCapsuleScope when an incoming claim overlaps an active
 * claim held by another capsule. Carries the conflicts so the MCP boundary can
 * surface them to the caller (who must coordinate, pick different scope, or pass
 * force to deliberately co-claim).
 */
export class ScopeOverlapError extends Error {
  readonly conflicts: ScopeConflict[];
  constructor(conflicts: ScopeConflict[]) {
    super(
      `Scope overlap with ${conflicts.length} active claim(s) on other Work Capsule(s): ` +
        conflicts.map((c) => `${c.kind}:${c.value} (held by ${c.capsuleId})`).join(", "),
    );
    this.name = "ScopeOverlapError";
    this.conflicts = conflicts;
  }
}

/**
 * Find active claims on OTHER capsules that conflict with `claims`. "Active" =
 * not archived, not in a terminal status, and (for lease-backed executors) the
 * lease has not expired — an expired-lease capsule has released its hold, so its
 * scope is reclaimable. Conflict detection is done in JS over the parsed
 * scopeClaims JSON (the active-capsule population is small), mirroring how the
 * rest of this store reasons about scope.
 */
export async function detectScopeConflicts(args: {
  db: CapsuleDb;
  capsuleId: string;
  claims: ScopeClaimInput[];
  now?: Date;
}): Promise<ScopeConflict[]> {
  if (args.claims.length === 0) return [];

  const now = args.now ?? new Date();
  const others = await args.db.workroom.findMany({
    where: {
      capsuleId: { not: args.capsuleId },
      archivedAt: null,
      status: { notIn: TERMINAL_CAPSULE_STATUSES },
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { gt: now } }],
    },
    select: {
      capsuleId: true,
      title: true,
      scopeClaims: true,
      leaseHolderPrincipalId: true,
    },
  });

  const conflicts: ScopeConflict[] = [];
  for (const other of others ?? []) {
    for (const existing of parseScopeClaims(other.scopeClaims)) {
      // A `path` claim covers its whole subtree, so a directory claim conflicts
      // with a file/dir beneath it (and vice-versa) even though the kind:value
      // strings differ — without this, `path:dir/` and `path:dir/file.ts` were
      // treated as disjoint and two sessions could both "own" overlapping edit
      // scope. Non-path kinds keep exact-value matching.
      const incoming = args.claims.find(
        (c) =>
          c.kind === existing.kind &&
          scopeValuesOverlap(existing.kind, existing.value, c.value) &&
          intentsConflict(existing.intent, c.intent),
      );
      if (incoming) {
        conflicts.push({
          capsuleId: other.capsuleId,
          title: other.title,
          kind: existing.kind,
          value: existing.value,
          existingIntent: existing.intent,
          incomingIntent: incoming.intent,
          leaseHolderPrincipalId: other.leaseHolderPrincipalId ?? null,
        });
      }
    }
  }
  return conflicts;
}

export async function claimWorkCapsuleScope(args: {
  db: CapsuleDb;
  capsuleId: string;
  claims: ScopeClaimInput[];
  actor: WorkCapsuleActor;
  now?: Date;
  /** Deliberately co-claim despite an overlap with another active capsule. */
  force?: boolean;
  /** Prospective, advisory impact derived before the scope write. */
  buildChangeImpactContract?: (paths: string[]) => Promise<CapsuleChangeImpactContract>;
}) {
  const capsule = await args.db.workroom.findUnique({
    where: { capsuleId: args.capsuleId },
  });
  if (!capsule) throw new Error(`Work Capsule ${args.capsuleId} not found`);

  // BI-95E37EA1: never append scope claims to a terminal or foreign capsule.
  // The abandoned-main false-success path used to land claims on an unrelated
  // WC; refuse here so even a stale capsuleId cannot pollute its audit trail.
  if (isTerminalCapsuleStatus(capsule.status) || capsule.archivedAt != null) {
    throw new Error(
      `Work Capsule ${args.capsuleId} is ${capsule.status ?? "terminal"} and cannot accept scope claims. ` +
        "Claim a live capsule (or re-run claim_backlog_item_for_work to mint a fresh one).",
    );
  }

  // Capsule-first enforcement: refuse to claim scope already held by another
  // active capsule unless the caller explicitly forces it. This is the lock that
  // stops two sessions from building the same BI / editing the same files.
  const conflicts = await detectScopeConflicts({
    db: args.db,
    capsuleId: args.capsuleId,
    claims: args.claims,
    now: args.now,
  });
  if (conflicts.length > 0 && !args.force) {
    throw new ScopeOverlapError(conflicts);
  }

  const recordedAt = (args.now ?? new Date()).toISOString();
  const nextClaims = new Map<string, ScopeClaim>();
  for (const entry of parseScopeClaims(capsule.scopeClaims)) {
    nextClaims.set(`${entry.kind}:${entry.value}`, entry);
  }

  const added: ScopeClaim[] = [];
  const refreshed: ScopeClaim[] = [];
  for (const claim of args.claims) {
    const normalized: ScopeClaim = {
      kind: claim.kind,
      value: claim.value,
      intent: claim.intent,
      recordedAt,
      recordedByPrincipalId: args.actor.principalId ?? "",
    };
    const key = `${normalized.kind}:${normalized.value}`;
    if (nextClaims.has(key)) refreshed.push(normalized);
    else added.push(normalized);
    nextClaims.set(key, normalized);
  }

  const scopeClaims = Array.from(nextClaims.values());
  const impact = await planCapsuleChangeImpact({
    scopeClaims,
    incomingClaims: args.claims,
    verificationState: capsule.verificationState,
    build: args.buildChangeImpactContract,
  });
  return inTransaction(args.db, async (tx) => {
    const updated = await tx.workroom.update({
      where: { capsuleId: args.capsuleId },
      data: {
        scopeClaims,
        ...(impact.verificationState ? { verificationState: impact.verificationState } : {}),
      },
    });
    await recordActivity(tx, {
      workCapsuleId: capsule.id,
      kind: "scope-claimed",
      summary:
        conflicts.length > 0
          ? `Force-claimed ${added.length} new scope item(s) over ${conflicts.length} active conflict(s); refreshed ${refreshed.length}.`
          : `Claimed ${added.length} new scope item(s); refreshed ${refreshed.length}.`,
      payload: {
        added,
        refreshed,
        ...(conflicts.length > 0 ? { forcedOverConflicts: conflicts } : {}),
      },
      actor: args.actor,
    });
    if (impact.activity) {
      await recordActivity(tx, {
        workCapsuleId: capsule.id,
        ...impact.activity,
        actor: args.actor,
      });
    }
    return { ...updated, changeImpactContract: impact.contract };
  });
}

export async function releaseWorkCapsuleScope(args: {
  db: CapsuleDb;
  capsuleId: string;
  claims: ScopeReleaseInput[];
  actor: WorkCapsuleActor;
}) {
  const capsule = await args.db.workroom.findUnique({
    where: { capsuleId: args.capsuleId },
  });
  if (!capsule) throw new Error(`Work Capsule ${args.capsuleId} not found`);

  const releaseKeys = new Set(args.claims.map((claim) => `${claim.kind}:${claim.value}`));
  const existing = parseScopeClaims(capsule.scopeClaims);
  const scopeClaims = existing.filter((claim) => !releaseKeys.has(`${claim.kind}:${claim.value}`));
  const released = existing.filter((claim) => releaseKeys.has(`${claim.kind}:${claim.value}`));

  return inTransaction(args.db, async (tx) => {
    const updated = await tx.workroom.update({
      where: { capsuleId: args.capsuleId },
      data: { scopeClaims },
    });
    await recordActivity(tx, {
      workCapsuleId: capsule.id,
      kind: "scope-released",
      summary: `Released ${released.length} scope item(s).`,
      payload: { released },
      actor: args.actor,
    });
    return updated;
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
  if (args.status === "complete" && hasGovernedLink) {
    return completeGovernedWorkCapsuleStatus({
      db: args.db,
      capsuleId: args.capsuleId,
      expectedStatus: capsule.status,
      reason: args.reason,
      actor: args.actor,
      evaluatedAt: (args.now ?? new Date()).toISOString(),
    });
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

  return inTransaction(args.db, async (tx) => {
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
}
