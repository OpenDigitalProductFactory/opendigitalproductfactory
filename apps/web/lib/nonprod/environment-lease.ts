import { randomUUID } from "node:crypto";
import { prisma } from "@dpf/db";

export type NonprodEnvironmentKey = "active-candidate" | "local-integration-ci";
export type NonprodOwnerProvider = "build-studio" | "claude" | "codex" | "coworker";

type LeaseDb = Pick<typeof prisma, "nonProductionEnvironmentLease">;

function createLeaseId() {
  return `NPEL-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
}

export async function listActiveNonprodEnvironmentLeases(input: {
  db?: LeaseDb;
  now?: Date;
}) {
  const db = input.db ?? prisma;
  const now = input.now ?? new Date();
  return db.nonProductionEnvironmentLease.findMany({
    where: {
      status: "active",
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function claimNonprodEnvironmentLease(input: {
  db?: LeaseDb;
  environmentKey: NonprodEnvironmentKey;
  ownerProvider: NonprodOwnerProvider;
  ownerSessionId: string;
  purpose: string;
  url: string;
  ports: number[];
  expiresAt: Date;
  worktreePath?: string;
  branchName?: string;
  buildId?: string;
  taskRunId?: string;
  cleanupCommand?: string;
  now?: Date;
}) {
  const db = input.db ?? prisma;
  const active = await db.nonProductionEnvironmentLease.findFirst({
    where: {
      environmentKey: input.environmentKey,
      status: "active",
      expiresAt: { gt: input.now ?? new Date() },
    },
  });
  if (active) return { status: "conflict" as const, active };

  const lease = await db.nonProductionEnvironmentLease.create({
    data: {
      leaseId: createLeaseId(),
      environmentKey: input.environmentKey,
      ownerProvider: input.ownerProvider,
      ownerSessionId: input.ownerSessionId,
      purpose: input.purpose,
      url: input.url,
      ports: input.ports,
      expiresAt: input.expiresAt,
      worktreePath: input.worktreePath,
      branchName: input.branchName,
      buildId: input.buildId,
      taskRunId: input.taskRunId,
      cleanupCommand: input.cleanupCommand,
    },
  });
  return { status: "claimed" as const, lease };
}

export async function releaseNonprodEnvironmentLease(input: {
  db?: LeaseDb;
  leaseId: string;
  now?: Date;
}) {
  const db = input.db ?? prisma;
  return db.nonProductionEnvironmentLease.update({
    where: { leaseId: input.leaseId },
    data: {
      status: "released",
      releasedAt: input.now ?? new Date(),
    },
  });
}
