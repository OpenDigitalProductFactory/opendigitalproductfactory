// apps/web/lib/contributor-change-lanes/read-model.ts
// Phase 3 of BI-063BDF1B — DB-only read model.
//
// The read model no longer accepts inventory runners. Snapshot sources
// (git-worktree, git-branch, github-pr) come from ContributorInventorySnapshot
// rows resolved via latest-successful-per-source semantics, so a partial sync
// preserves prior good data for each source independently. Live Prisma sources
// (work-capsule, runtime-target, runtime-verification, nonprod-lease) are read
// at request time as today.
//
// Spec: docs/superpowers/specs/2026-05-26-contributor-inventory-sync-design.md
//   §"Read Model"
//
// Phase 8 (BI-063BDF1B) deleted the deprecated `runners-node.ts` after
// Phases 1-7 had soaked on `main`. No caller imports it anymore.

import { prisma } from "@dpf/db";

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
  | "workroom"
  | "runtimeTarget"
  | "runtimeVerification"
  | "nonProductionEnvironmentLease"
  | "contributorInventorySyncRun"
  | "credentialEntry"
>;

export type LaneReadModelSource =
  | "work-capsule"
  | "runtime-target"
  | "runtime-verification"
  | "nonprod-lease"
  | "git-worktree"
  | "git-branch"
  | "github-pr";

/** Distinct states the freshness band can render — see spec §"Freshness display". */
export type LaneReadModelFreshnessState =
  | "ok"
  | "stale"
  | "error"
  | "not-configured"
  | "warming-up";

export type LaneReadModelFreshness = {
  source: LaneReadModelSource;
  state: LaneReadModelFreshnessState;
  fetchedAt: Date;
  message: string | null;
  count: number;
};

export type LaneReadModelResult = {
  lanes: ContributorChangeLane[];
  freshness: LaneReadModelFreshness[];
  /** True iff at least one snapshot source has state === "warming-up". */
  anySourceWarmingUp: boolean;
  /** True iff any snapshot source has a non-"ok" state (used by tab-count warning). */
  anySnapshotSourceDegraded: boolean;
};

export type LaneReadModelArgs = {
  db?: ReadModelDb;
  now?: Date;
  /** Threshold (ms) past which a snapshot's fetchedAt flips to state "stale". */
  staleHeartbeatThresholdMs?: number;
  staleVerifiedThresholdMs?: number;
};

const DEFAULT_STALE_THRESHOLD_MS = 20 * 60 * 1000;
const GITHUB_PR_CREDENTIAL_PROVIDER_ID = "github-pr-sync";

const SNAPSHOT_SOURCES: ("git-worktree" | "git-branch" | "github-pr")[] = [
  "git-worktree",
  "git-branch",
  "github-pr",
];

type SnapshotRowLike = {
  payload: unknown;
};

type SyncRunRowLike = {
  syncRunId: string;
  startedAt: Date;
  completedAt: Date | null;
  status: string;
  perSourceResult: unknown;
  snapshots: SnapshotRowLike[];
};

export async function loadContributorChangeLaneReadModel(
  args: LaneReadModelArgs = {},
): Promise<LaneReadModelResult> {
  const db = args.db ?? prisma;
  const now = args.now ?? new Date();
  const staleThresholdMs = args.staleHeartbeatThresholdMs ?? DEFAULT_STALE_THRESHOLD_MS;

  const freshness: LaneReadModelFreshness[] = [];

  const [workCapsules, runtimeTargets, runtimeVerifications, leases] = await Promise.all([
    readWorkCapsules(db, freshness, now),
    readRuntimeTargets(db, freshness, now),
    readRuntimeVerifications(db, freshness, now),
    readActiveLeases(db, freshness, now),
  ]);

  const [worktrees, branches, pullRequests, githubCredentialBound] = await Promise.all([
    readSnapshotSource<GitWorktreeSnapshot>(db, "git-worktree", freshness, now, staleThresholdMs, null),
    readSnapshotSource<GitBranchSnapshot>(db, "git-branch", freshness, now, staleThresholdMs, null),
    Promise.resolve([] as PullRequestSnapshot[]).then(() => null), // placeholder, see below
    isGithubPrCredentialBound(db),
  ]);

  // We deferred the github-pr read so we know whether the credential is
  // bound before deciding whether absence-of-data means "not-configured"
  // (no credential) or "warming-up" (no run yet).
  const githubPrRows = await readSnapshotSource<PullRequestSnapshot>(
    db,
    "github-pr",
    freshness,
    now,
    staleThresholdMs,
    githubCredentialBound ? null : "not-configured",
  );

  // (PR snapshot read above; we drop the placeholder value.)
  void pullRequests;

  const projection = projectContributorChangeLanes({
    workCapsules,
    runtimeTargets,
    runtimeVerifications,
    leases,
    worktrees,
    branches,
    pullRequests: githubPrRows,
    now,
    staleHeartbeatThresholdMs: args.staleHeartbeatThresholdMs,
    staleVerifiedThresholdMs: args.staleVerifiedThresholdMs,
  });

  const snapshotStates = freshness
    .filter((f) => SNAPSHOT_SOURCES.includes(f.source as (typeof SNAPSHOT_SOURCES)[number]))
    .map((f) => f.state);

  return {
    lanes: projection.lanes,
    freshness,
    anySourceWarmingUp: snapshotStates.includes("warming-up"),
    anySnapshotSourceDegraded: snapshotStates.some((s) => s !== "ok"),
  };
}

// ─── Snapshot source resolver (latest-successful-per-source) ────────────────

async function readSnapshotSource<T>(
  db: ReadModelDb,
  source: "git-worktree" | "git-branch" | "github-pr",
  freshness: LaneReadModelFreshness[],
  now: Date,
  staleThresholdMs: number,
  forcedNotConfiguredReason: "not-configured" | null,
): Promise<T[]> {
  if (forcedNotConfiguredReason === "not-configured") {
    freshness.push({
      source,
      state: "not-configured",
      fetchedAt: now,
      message:
        "GitHub not connected — connect on the Contributor MCP card to populate PR data",
      count: 0,
    });
    return [];
  }

  let row: SyncRunRowLike | null = null;
  try {
    row = (await db.contributorInventorySyncRun.findFirst({
      where: {
        // Latest run where this source was OK. Status is not the filter —
        // the audit-only status field can be "partial" even when this
        // specific source succeeded; the source's `ok: true` in
        // perSourceResult is the truth.
        perSourceResult: { path: [source, "ok"], equals: true },
      },
      orderBy: { startedAt: "desc" },
      select: {
        syncRunId: true,
        startedAt: true,
        completedAt: true,
        status: true,
        perSourceResult: true,
        snapshots: {
          where: { source },
          select: { payload: true },
        },
      },
    })) as SyncRunRowLike | null;
  } catch (err) {
    freshness.push({
      source,
      state: "error",
      fetchedAt: now,
      message: (err as Error).message ?? "snapshot read failed",
      count: 0,
    });
    return [];
  }

  if (!row) {
    // No successful run for this source yet — warming up.
    freshness.push({
      source,
      state: "warming-up",
      fetchedAt: now,
      message: "Syncing — first results within ~10 min",
      count: 0,
    });
    return [];
  }

  const rows = row.snapshots.map((s) => s.payload as T);
  const fetchedAt = row.completedAt ?? row.startedAt;
  const ageMs = now.getTime() - fetchedAt.getTime();
  const state: LaneReadModelFreshnessState = ageMs > staleThresholdMs ? "stale" : "ok";

  freshness.push({
    source,
    state,
    fetchedAt,
    message:
      state === "stale"
        ? `Last successful sync ${Math.floor(ageMs / 60_000)} min ago`
        : null,
    count: rows.length,
  });
  return rows;
}

async function isGithubPrCredentialBound(db: ReadModelDb): Promise<boolean> {
  try {
    const cred = await db.credentialEntry.findFirst({
      where: { providerId: GITHUB_PR_CREDENTIAL_PROVIDER_ID, status: "active" },
      select: { id: true },
    });
    return cred !== null;
  } catch {
    // If the credential check itself fails, treat as not-bound — the
    // surfaced state will be "not-configured" which is the safer message
    // than "error" for an unconfigured customer install.
    return false;
  }
}

// ─── Live Prisma source readers (unchanged shape from Phase 1) ──────────────

async function readWorkCapsules(
  db: ReadModelDb,
  freshness: LaneReadModelFreshness[],
  now: Date,
): Promise<WorkCapsuleSnapshot[]> {
  try {
    const rows = await db.workroom.findMany({
      where: { status: { notIn: ["archived"] } },
      orderBy: { updatedAt: "desc" },
      take: 250,
      select: {
        capsuleId: true,
        title: true,
        status: true,
        executorKind: true,
        executorRef: true,
        decisionScope: true,
        portfolioRole: true,
        servedPersona: true,
        activityKind: true,
        outcomeAnchor: true,
        headBranch: true,
        headSha: true,
        worktreePath: true,
        pullRequestUrl: true,
        backlogItemId: true,
        featureBuildId: true,
        leaseHolderPrincipalId: true,
        leaseExpiresAt: true,
        updatedAt: true,
        objective: true,
      },
    });
    const out = rows.map(toWorkCapsuleSnapshot);
    freshness.push({
      source: "work-capsule",
      state: "ok",
      fetchedAt: now,
      message: null,
      count: out.length,
    });
    return out;
  } catch (err) {
    freshness.push({
      source: "work-capsule",
      state: "error",
      fetchedAt: now,
      message: (err as Error).message ?? "read failed",
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
      where: { status: { notIn: ["released", "expired"] } },
      orderBy: { updatedAt: "desc" },
      take: 250,
    });
    const out = rows.map(toRuntimeTargetSnapshot);
    freshness.push({
      source: "runtime-target",
      state: "ok",
      fetchedAt: now,
      message: null,
      count: out.length,
    });
    return out;
  } catch (err) {
    freshness.push({
      source: "runtime-target",
      state: "error",
      fetchedAt: now,
      message: (err as Error).message ?? "read failed",
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
      state: "ok",
      fetchedAt: now,
      message: null,
      count: out.length,
    });
    return out;
  } catch (err) {
    freshness.push({
      source: "runtime-verification",
      state: "error",
      fetchedAt: now,
      message: (err as Error).message ?? "read failed",
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
    freshness.push({
      source: "nonprod-lease",
      state: "ok",
      fetchedAt: now,
      message: null,
      count: out.length,
    });
    return out;
  } catch (err) {
    freshness.push({
      source: "nonprod-lease",
      state: "error",
      fetchedAt: now,
      message: (err as Error).message ?? "read failed",
      count: 0,
    });
    return [];
  }
}

// ─── Prisma row → snapshot type shims (unchanged from prior implementation) ──

type WorkCapsuleRowLike = {
  capsuleId: string;
  title: string;
  status: string;
  executorKind: string | null;
  executorRef: string | null;
  decisionScope: string | null;
  portfolioRole: string | null;
  servedPersona: string | null;
  activityKind: string | null;
  outcomeAnchor: unknown;
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
    decisionScope: row.decisionScope,
    portfolioRole: row.portfolioRole,
    servedPersona: row.servedPersona,
    activityKind: row.activityKind,
    outcomeAnchor: row.outcomeAnchor,
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
  const servedCommitSha =
    typeof md.servedCommitSha === "string" ? md.servedCommitSha : row.serviceVersion;
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

function toRuntimeVerificationSnapshot(
  row: RuntimeVerificationRowLike,
): RuntimeVerificationSnapshot {
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
