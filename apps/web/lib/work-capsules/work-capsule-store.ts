import { randomUUID } from "node:crypto";

import {
  LEASE_TTL_MS,
  STATUS_OVERRIDE_TTL_MS,
  buildCapsuleBranchName,
  buildCapsuleSlug,
  buildCapsuleWorktreePath,
  isRootClonePath,
  isWorkCapsuleEvidenceKind,
  isWorkCapsuleExecutorKind,
  isWorkCapsuleSource,
  isWorkCapsuleStatus,
  normalizeBranchTaxonomy,
  parseScopeClaims,
  type ScopeClaim,
  type WorkCapsuleActivityKind,
  type WorkCapsuleBranchTaxonomy,
  type WorkCapsuleEvidenceKind,
  type WorkCapsuleExecutorKind,
  type WorkCapsuleSource,
  type WorkCapsuleStatus,
} from "@/lib/work-capsules";
import { revalidatePortalContext } from "@/lib/portal-context/invalidation";

export type WorkCapsuleActor = {
  userId: string;
  agentId: string | null;
  principalId: string | null;
};

export type CapsuleDb = {
  workCapsule: {
    create(args: unknown): Promise<any>;
    findFirst(args: unknown): Promise<any>;
    findUnique(args: unknown): Promise<any>;
    update(args: unknown): Promise<any>;
  };
  workCapsuleActivity: {
    create(args: unknown): Promise<any>;
  };
  $transaction?<T>(fn: (tx: CapsuleDb) => Promise<T>): Promise<T>;
};

type CapsuleCreateInput = {
  title: string;
  objective: string;
  source: WorkCapsuleSource;
  idempotencyKey: string;
  executorKind?: WorkCapsuleExecutorKind | null;
  executorRef?: string | null;
  status?: WorkCapsuleStatus;
  backlogItemId?: string | null;
  epicId?: string | null;
  featureBuildId?: string | null;
  workspaceState?: Record<string, unknown>;
};

type CapsuleAdoptionInput = {
  title: string;
  objective: string;
  repositoryFullName: string;
  headBranch: string;
  worktreePath: string;
  baseBranch?: string | null;
  baseSha?: string | null;
  headSha?: string | null;
  executorKind?: WorkCapsuleExecutorKind | null;
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

function leaseUntil(now = new Date()): Date {
  return new Date(now.getTime() + LEASE_TTL_MS);
}

function isExternalLeaseExecutor(executorKind: WorkCapsuleExecutorKind | null | undefined): boolean {
  return (
    executorKind === "codex-desktop" ||
    executorKind === "claude-desktop" ||
    executorKind === "grok-desktop" ||
    executorKind === "human"
  );
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

async function inTransaction<T>(db: CapsuleDb, fn: (tx: CapsuleDb) => Promise<T>): Promise<T> {
  return db.$transaction ? db.$transaction(fn) : fn(db);
}

async function recordActivity(
  db: CapsuleDb,
  input: {
    workCapsuleId: string;
    kind: WorkCapsuleActivityKind;
    summary: string;
    payload?: Record<string, unknown>;
    actor: WorkCapsuleActor;
  },
) {
  const activity = await db.workCapsuleActivity.create({
    data: {
      workCapsuleId: input.workCapsuleId,
      kind: input.kind,
      summary: input.summary,
      payload: input.payload ?? {},
      recordedById: input.actor.userId,
      recordedByAgentId: input.actor.agentId,
    },
  });
  revalidatePortalContext();
  return activity;
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

  const existing = await args.db.workCapsule.findUnique({
    where: { idempotencyKey: args.input.idempotencyKey },
  });
  if (existing) return existing;

  const now = new Date();
  try {
    return await inTransaction(args.db, async (tx) => {
      const created = await tx.workCapsule.create({
        data: {
          capsuleId: nextCapsuleId(),
          title: args.input.title,
          objective: args.input.objective,
          source: args.input.source,
          executorKind: args.input.executorKind ?? null,
          executorRef: args.input.executorRef ?? null,
          backlogItemId: args.input.backlogItemId ?? null,
          epicId: args.input.epicId ?? null,
          featureBuildId: args.input.featureBuildId ?? null,
          workspaceState: args.input.workspaceState ?? {},
          idempotencyKey: args.input.idempotencyKey,
          leaseHolderPrincipalId: isExternalLeaseExecutor(args.input.executorKind)
            ? args.actor.principalId
            : null,
          leaseExpiresAt: isExternalLeaseExecutor(args.input.executorKind) ? leaseUntil(now) : null,
          createdByPrincipalId: args.actor.principalId,
          status: args.input.status ?? (args.input.executorKind ? "ready" : "draft"),
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
      const winner = await args.db.workCapsule.findUnique({
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

  const existing = await args.db.workCapsule.findFirst({
    where: {
      repositoryFullName: args.input.repositoryFullName,
      headBranch: args.input.headBranch,
      archivedAt: null,
    },
  });
  if (existing) return existing;

  const now = new Date();
  try {
    return await inTransaction(args.db, async (tx) => {
      const capsule = await tx.workCapsule.create({
        data: {
          capsuleId: nextCapsuleId(),
          title: args.input.title,
          objective: args.input.objective,
          source: "external-adoption",
          status: "ready",
          executorKind: args.input.executorKind ?? null,
          repositoryFullName: args.input.repositoryFullName,
          baseBranch: args.input.baseBranch ?? "main",
          baseSha: args.input.baseSha ?? null,
          headBranch: args.input.headBranch,
          headSha: args.input.headSha ?? null,
          worktreePath: args.input.worktreePath,
          branchTaxonomy: normalizeBranchTaxonomy(args.input.headBranch),
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
      const winner = await args.db.workCapsule.findFirst({
        where: {
          repositoryFullName: args.input.repositoryFullName,
          headBranch: args.input.headBranch,
          archivedAt: null,
        },
      });
      if (winner) return winner;
    }
    throw error;
  }
}

async function hasWorkspaceCollision(
  db: CapsuleDb,
  args: { capsuleId: string; headBranch: string; worktreePath: string },
): Promise<boolean> {
  const existing = await db.workCapsule.findFirst({
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

  const capsule = await args.db.workCapsule.findUnique({
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
    const updated = await tx.workCapsule.update({
      where: { capsuleId: input.capsuleId },
      data: {
        headBranch,
        worktreePath,
        branchTaxonomy: input.taxonomy,
        baseBranch: capsule.baseBranch ?? "main",
        status: capsule.status === "draft" ? "ready" : capsule.status,
      },
    });
    await recordActivity(tx, {
      workCapsuleId: capsule.id,
      kind: "workspace-planned",
      summary: `Planned ${headBranch} at ${worktreePath}`,
      payload: { headBranch, worktreePath, branchTaxonomy: input.taxonomy },
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
    const capsule = await tx.workCapsule.update({
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

export async function recordWorkCapsuleEvidence(args: {
  db: CapsuleDb;
  capsuleId: string;
  evidence: CapsuleEvidenceInput;
  actor: WorkCapsuleActor;
}) {
  if (!isWorkCapsuleEvidenceKind(args.evidence.kind)) {
    throw new Error("Invalid evidence kind");
  }

  const capsule = await args.db.workCapsule.findUnique({
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

export async function claimWorkCapsuleScope(args: {
  db: CapsuleDb;
  capsuleId: string;
  claims: ScopeClaimInput[];
  actor: WorkCapsuleActor;
  now?: Date;
}) {
  const capsule = await args.db.workCapsule.findUnique({
    where: { capsuleId: args.capsuleId },
  });
  if (!capsule) throw new Error(`Work Capsule ${args.capsuleId} not found`);

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
  return inTransaction(args.db, async (tx) => {
    const updated = await tx.workCapsule.update({
      where: { capsuleId: args.capsuleId },
      data: { scopeClaims },
    });
    await recordActivity(tx, {
      workCapsuleId: capsule.id,
      kind: "scope-claimed",
      summary: `Claimed ${added.length} new scope item(s); refreshed ${refreshed.length}.`,
      payload: { added, refreshed },
      actor: args.actor,
    });
    return updated;
  });
}

export async function releaseWorkCapsuleScope(args: {
  db: CapsuleDb;
  capsuleId: string;
  claims: ScopeReleaseInput[];
  actor: WorkCapsuleActor;
}) {
  const capsule = await args.db.workCapsule.findUnique({
    where: { capsuleId: args.capsuleId },
  });
  if (!capsule) throw new Error(`Work Capsule ${args.capsuleId} not found`);

  const releaseKeys = new Set(args.claims.map((claim) => `${claim.kind}:${claim.value}`));
  const existing = parseScopeClaims(capsule.scopeClaims);
  const scopeClaims = existing.filter((claim) => !releaseKeys.has(`${claim.kind}:${claim.value}`));
  const released = existing.filter((claim) => releaseKeys.has(`${claim.kind}:${claim.value}`));

  return inTransaction(args.db, async (tx) => {
    const updated = await tx.workCapsule.update({
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

  const capsule = await args.db.workCapsule.findUnique({
    where: { capsuleId: args.capsuleId },
  });
  if (!capsule) throw new Error(`Work Capsule ${args.capsuleId} not found`);

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
    const updated = await tx.workCapsule.update({
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
