import { prisma } from "@dpf/db";

import { mergeFilesystemAndRegisteredWorktrees, parseGitBranchList, parseGitWorktreeList } from "./git-inventory";
import { parseGhPrListJson } from "./github-inventory";
import { projectContributorChangeLanes } from "./lane-projection";
import type {
  ContributorChangeLane,
  GitBranchSnapshot,
  GitWorktreeSnapshot,
  NonprodEnvironmentLeaseSnapshot,
  PullRequestSnapshot,
  RuntimeTargetSnapshot,
  RuntimeVerificationSnapshot,
  WorkCapsuleSnapshot,
} from "./types";

type ReadModelDb = Pick<
  typeof prisma,
  "workCapsule" | "runtimeTarget" | "runtimeVerification" | "nonProductionEnvironmentLease"
>;

export type LaneReadModelSource = "work-capsule" | "runtime-target" | "runtime-verification" | "nonprod-lease" | "git-worktree" | "git-branch" | "github-pr";

export type LaneReadModelFreshness = {
  source: LaneReadModelSource;
  ok: boolean;
  fetchedAt: Date;
  error: string | null;
  count: number;
};

export type LaneReadModelResult = {
  lanes: ContributorChangeLane[];
  freshness: LaneReadModelFreshness[];
};

export type LaneReadModelInventoryRunners = {
  runGitWorktreeList: () => Promise<string>;
  runGitForEachRef: () => Promise<string>;
  runGhPrList: () => Promise<string>;
  listFilesystemWorktreePaths: () => Promise<string[]>;
};

export type LaneReadModelArgs = {
  db?: ReadModelDb;
  runners?: Partial<LaneReadModelInventoryRunners>;
  now?: Date;
  staleHeartbeatThresholdMs?: number;
  staleVerifiedThresholdMs?: number;
};

export async function loadContributorChangeLaneReadModel(
  args: LaneReadModelArgs = {},
): Promise<LaneReadModelResult> {
  const db = args.db ?? prisma;
  const now = args.now ?? new Date();
  const runners = args.runners ?? {};

  const freshness: LaneReadModelFreshness[] = [];

  const [workCapsules, runtimeTargets, runtimeVerifications, leases] = await Promise.all([
    readWorkCapsules(db, freshness, now),
    readRuntimeTargets(db, freshness, now),
    readRuntimeVerifications(db, freshness, now),
    readActiveLeases(db, freshness, now),
  ]);

  const [worktrees, branches, pullRequests] = await Promise.all([
    readWorktreeInventory(runners, freshness, now),
    readBranchInventory(runners, freshness, now),
    readPullRequestInventory(runners, freshness, now),
  ]);

  const projection = projectContributorChangeLanes({
    workCapsules,
    runtimeTargets,
    runtimeVerifications,
    leases,
    worktrees,
    branches,
    pullRequests,
    now,
    staleHeartbeatThresholdMs: args.staleHeartbeatThresholdMs,
    staleVerifiedThresholdMs: args.staleVerifiedThresholdMs,
  });

  return { lanes: projection.lanes, freshness };
}

async function readWorkCapsules(
  db: ReadModelDb,
  freshness: LaneReadModelFreshness[],
  now: Date,
): Promise<WorkCapsuleSnapshot[]> {
  try {
    const rows = await db.workCapsule.findMany({
      where: {
        status: { notIn: ["archived"] },
      },
      orderBy: { updatedAt: "desc" },
      take: 250,
    });
    const out = rows.map(toWorkCapsuleSnapshot);
    freshness.push({ source: "work-capsule", ok: true, fetchedAt: now, error: null, count: out.length });
    return out;
  } catch (err) {
    freshness.push({
      source: "work-capsule",
      ok: false,
      fetchedAt: now,
      error: (err as Error).message,
      count: 0,
    });
    return [];
  }
}

async function readRuntimeTargets(
  db: ReadModelDb,
  freshness: LaneReadModelFreshness[],
  now: Date,
): Promise<RuntimeTargetSnapshot[]> {
  try {
    const rows = await db.runtimeTarget.findMany({
      where: {
        status: { notIn: ["released", "expired"] },
      },
      orderBy: { updatedAt: "desc" },
      take: 250,
    });
    const out = rows.map(toRuntimeTargetSnapshot);
    freshness.push({ source: "runtime-target", ok: true, fetchedAt: now, error: null, count: out.length });
    return out;
  } catch (err) {
    freshness.push({
      source: "runtime-target",
      ok: false,
      fetchedAt: now,
      error: (err as Error).message,
      count: 0,
    });
    return [];
  }
}

async function readRuntimeVerifications(
  db: ReadModelDb,
  freshness: LaneReadModelFreshness[],
  now: Date,
): Promise<RuntimeVerificationSnapshot[]> {
  try {
    const rows = await db.runtimeVerification.findMany({
      where: { runtimeTargetId: { not: null } },
      orderBy: { completedAt: "desc" },
      take: 500,
    });
    const out = rows.map(toRuntimeVerificationSnapshot);
    freshness.push({
      source: "runtime-verification",
      ok: true,
      fetchedAt: now,
      error: null,
      count: out.length,
    });
    return out;
  } catch (err) {
    freshness.push({
      source: "runtime-verification",
      ok: false,
      fetchedAt: now,
      error: (err as Error).message,
      count: 0,
    });
    return [];
  }
}

async function readActiveLeases(
  db: ReadModelDb,
  freshness: LaneReadModelFreshness[],
  now: Date,
): Promise<NonprodEnvironmentLeaseSnapshot[]> {
  try {
    const rows = await db.nonProductionEnvironmentLease.findMany({
      where: { status: "active" },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const out = rows.map(toLeaseSnapshot);
    freshness.push({ source: "nonprod-lease", ok: true, fetchedAt: now, error: null, count: out.length });
    return out;
  } catch (err) {
    freshness.push({
      source: "nonprod-lease",
      ok: false,
      fetchedAt: now,
      error: (err as Error).message,
      count: 0,
    });
    return [];
  }
}

async function readWorktreeInventory(
  runners: Partial<LaneReadModelInventoryRunners>,
  freshness: LaneReadModelFreshness[],
  now: Date,
): Promise<GitWorktreeSnapshot[]> {
  if (!runners.runGitWorktreeList) {
    freshness.push({ source: "git-worktree", ok: false, fetchedAt: now, error: "no runner configured", count: 0 });
    return [];
  }
  try {
    const porcelain = await runners.runGitWorktreeList();
    const registered = parseGitWorktreeList(porcelain);
    const filesystemPaths = runners.listFilesystemWorktreePaths
      ? await runners.listFilesystemWorktreePaths()
      : [];
    const merged = mergeFilesystemAndRegisteredWorktrees(registered, filesystemPaths);
    freshness.push({ source: "git-worktree", ok: true, fetchedAt: now, error: null, count: merged.length });
    return merged;
  } catch (err) {
    freshness.push({
      source: "git-worktree",
      ok: false,
      fetchedAt: now,
      error: (err as Error).message,
      count: 0,
    });
    return [];
  }
}

async function readBranchInventory(
  runners: Partial<LaneReadModelInventoryRunners>,
  freshness: LaneReadModelFreshness[],
  now: Date,
): Promise<GitBranchSnapshot[]> {
  if (!runners.runGitForEachRef) {
    freshness.push({ source: "git-branch", ok: false, fetchedAt: now, error: "no runner configured", count: 0 });
    return [];
  }
  try {
    const raw = await runners.runGitForEachRef();
    const branches = parseGitBranchList(raw, { remote: "origin" });
    freshness.push({ source: "git-branch", ok: true, fetchedAt: now, error: null, count: branches.length });
    return branches;
  } catch (err) {
    freshness.push({
      source: "git-branch",
      ok: false,
      fetchedAt: now,
      error: (err as Error).message,
      count: 0,
    });
    return [];
  }
}

async function readPullRequestInventory(
  runners: Partial<LaneReadModelInventoryRunners>,
  freshness: LaneReadModelFreshness[],
  now: Date,
): Promise<PullRequestSnapshot[]> {
  if (!runners.runGhPrList) {
    freshness.push({ source: "github-pr", ok: false, fetchedAt: now, error: "no runner configured", count: 0 });
    return [];
  }
  try {
    const json = await runners.runGhPrList();
    const result = parseGhPrListJson(json);
    const ok = result.errors.length === 0;
    freshness.push({
      source: "github-pr",
      ok,
      fetchedAt: now,
      error: ok ? null : result.errors.map((e) => e.message).join("; "),
      count: result.pullRequests.length,
    });
    return result.pullRequests;
  } catch (err) {
    freshness.push({
      source: "github-pr",
      ok: false,
      fetchedAt: now,
      error: (err as Error).message,
      count: 0,
    });
    return [];
  }
}

type WorkCapsuleRowLike = {
  capsuleId: string;
  title: string;
  status: string;
  executorKind: string | null;
  executorRef: string | null;
  headBranch: string | null;
  headSha: string | null;
  worktreePath: string | null;
  pullRequestUrl: string | null;
  backlogItemId: string | null;
  featureBuildId: string | null;
  leaseHolderPrincipalId: string | null;
  leaseExpiresAt: Date | null;
  updatedAt: Date | null;
  objective?: string | null;
};

function toWorkCapsuleSnapshot(row: WorkCapsuleRowLike): WorkCapsuleSnapshot {
  return {
    capsuleId: row.capsuleId,
    title: row.title,
    status: row.status,
    executorKind: row.executorKind,
    executorRef: row.executorRef,
    headBranch: row.headBranch,
    headSha: row.headSha,
    worktreePath: row.worktreePath,
    pullRequestUrl: row.pullRequestUrl,
    backlogItemId: row.backlogItemId,
    featureBuildId: row.featureBuildId,
    leaseHolderPrincipalId: row.leaseHolderPrincipalId,
    leaseExpiresAt: row.leaseExpiresAt,
    updatedAt: row.updatedAt,
    purpose: row.objective ?? null,
    nextAction: null,
  };
}

type RuntimeTargetRowLike = {
  targetId: string;
  kind: string;
  status: string;
  hostUrl: string | null;
  serviceVersion: string | null;
  workCapsuleId: string | null;
  featureBuildId: string | null;
  acceptanceRoleOverride: string | null;
  lastHeartbeatAt: Date | null;
  expiresAt: Date | null;
  metadata: unknown;
};

function toRuntimeTargetSnapshot(row: RuntimeTargetRowLike): RuntimeTargetSnapshot {
  const md = (row.metadata ?? {}) as Record<string, unknown>;
  const servedCommitSha = typeof md.servedCommitSha === "string" ? md.servedCommitSha : row.serviceVersion;
  const branchName = typeof md.branchName === "string" ? md.branchName : null;
  return {
    targetId: row.targetId,
    kind: row.kind,
    status: row.status,
    hostUrl: row.hostUrl,
    serviceVersion: row.serviceVersion,
    servedCommitSha,
    workCapsuleId: row.workCapsuleId,
    featureBuildId: row.featureBuildId,
    branchName,
    acceptanceRole: row.acceptanceRoleOverride,
    lastHeartbeatAt: row.lastHeartbeatAt,
    expiresAt: row.expiresAt,
  };
}

type RuntimeVerificationRowLike = {
  verificationId: string;
  runtimeTargetId: string | null;
  workCapsuleId: string | null;
  kind: string;
  status: string;
  completedAt: Date | null;
  result: unknown;
};

function toRuntimeVerificationSnapshot(row: RuntimeVerificationRowLike): RuntimeVerificationSnapshot {
  const result = (row.result ?? {}) as Record<string, unknown>;
  const summary = typeof result.summary === "string" ? result.summary : null;
  return {
    verificationId: row.verificationId,
    runtimeTargetId: row.runtimeTargetId,
    workCapsuleId: row.workCapsuleId,
    kind: row.kind,
    status: row.status,
    summary,
    completedAt: row.completedAt,
  };
}

type LeaseRowLike = {
  leaseId: string;
  environmentKey: string;
  status: string;
  ownerProvider: string;
  ownerSessionId: string | null;
  purpose: string | null;
  url: string | null;
  worktreePath: string | null;
  branchName: string | null;
  expiresAt: Date | null;
};

function toLeaseSnapshot(row: LeaseRowLike): NonprodEnvironmentLeaseSnapshot {
  return {
    leaseId: row.leaseId,
    environmentKey: row.environmentKey,
    status: row.status,
    ownerProvider: row.ownerProvider,
    ownerSessionId: row.ownerSessionId,
    purpose: row.purpose,
    url: row.url,
    worktreePath: row.worktreePath,
    branchName: row.branchName,
    expiresAt: row.expiresAt,
  };
}
