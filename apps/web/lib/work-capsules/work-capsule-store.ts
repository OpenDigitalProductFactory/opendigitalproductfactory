import { randomUUID } from "node:crypto";

import {
  LEASE_TTL_MS,
  isWorkCapsuleEvidenceKind,
  isWorkCapsuleExecutorKind,
  isWorkCapsuleSource,
  normalizeBranchTaxonomy,
  type WorkCapsuleActivityKind,
  type WorkCapsuleEvidenceKind,
  type WorkCapsuleExecutorKind,
  type WorkCapsuleSource,
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
