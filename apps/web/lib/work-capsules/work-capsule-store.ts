import { randomUUID } from "node:crypto";

import {
  LEASE_TTL_MS,
  STATUS_OVERRIDE_TTL_MS,
  isWorkCapsuleEvidenceKind,
  isWorkCapsuleExecutorKind,
  isWorkCapsuleSource,
  isWorkCapsuleStatus,
  normalizeBranchTaxonomy,
  parseScopeClaims,
  type ScopeClaim,
  type WorkCapsuleActivityKind,
  type WorkCapsuleEvidenceKind,
  type WorkCapsuleExecutorKind,
  type WorkCapsuleSource,
  type WorkCapsuleStatus,
} from "@/lib/work-capsules";

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
  result?: unknown;
};

type ScopeClaimInput = Pick<ScopeClaim, "kind" | "value" | "intent">;
type ScopeReleaseInput = Pick<ScopeClaim, "kind" | "value">;

function nextCapsuleId(): string {
  return `WC-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

function leaseUntil(now = new Date()): Date {
  return new Date(now.getTime() + LEASE_TTL_MS);
}

function isExternalLeaseExecutor(executorKind: WorkCapsuleExecutorKind | null | undefined): boolean {
  return executorKind === "codex-desktop" || executorKind === "claude-desktop" || executorKind === "human";
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
  return db.workCapsuleActivity.create({
    data: {
      workCapsuleId: input.workCapsuleId,
      kind: input.kind,
      summary: input.summary,
      payload: input.payload ?? {},
      recordedById: input.actor.userId,
      recordedByAgentId: input.actor.agentId,
    },
  });
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
          idempotencyKey: args.input.idempotencyKey,
          leaseHolderPrincipalId: isExternalLeaseExecutor(args.input.executorKind)
            ? args.actor.principalId
            : null,
          leaseExpiresAt: isExternalLeaseExecutor(args.input.executorKind) ? leaseUntil(now) : null,
          createdByPrincipalId: args.actor.principalId,
          status: args.input.executorKind ? "ready" : "draft",
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
