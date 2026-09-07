// apps/web/lib/work-capsules/liveness-inventory.ts
//
// WS9 (BI-CBAAEA94): the read-side of the liveness contract. Loads a page of
// WorkCapsules, joins each build-studio capsule's linked FeatureBuild (its only
// real liveness signal — phase + activity, never the frozen-at-14:00 updatedAt),
// and annotates every row with its true-liveness verdict plus a summary. Shared
// by the `list_work_capsules` MCP tool so the handler stays thin.

import { classifyWorkCapsuleLiveness } from "./liveness";
import { projectWorkroomRecovery } from "./workroom-recovery-projection";

const INVENTORY_SELECT = {
  capsuleId: true,
  title: true,
  status: true,
  source: true,
  backlogItemId: true,
  executorKind: true,
  executorRef: true,
  leaseHolderPrincipalId: true,
  repositoryFullName: true,
  decisionScope: true,
  portfolioRole: true,
  servedPersona: true,
  activityKind: true,
  outcomeAnchor: true,
  servesPortfolioRoles: true,
  dependsOnPortfolioRoles: true,
  headBranch: true,
  baseSha: true,
  headSha: true,
  worktreePath: true,
  pullRequestUrl: true,
  pullRequestNumber: true,
  leaseExpiresAt: true,
  lastSyncedAt: true,
  updatedAt: true,
  featureBuildId: true,
  taskRun: { select: { taskRunId: true, status: true, updatedAt: true } },
} as const;

type InventoryDb = {
  workroom: { findMany(args: unknown): Promise<any[]> };
  featureBuild: { findMany(args: unknown): Promise<any[]> };
  nonProductionEnvironmentLease?: { findMany(args: unknown): Promise<any[]> };
};

export type CapsuleLivenessSummary = {
  scanned: number;
  live: number;
  history: number;
  reapable: number;
  byLiveness: Record<string, number>;
  heavyLane: { executing: number; nextReady: number; dormant: number };
  progressSlo: { oldestWaitMs: number | null; maxNoTransitionMs: number | null };
};

/**
 * Load and liveness-annotate a page of capsules. Orders by updatedAt for a
 * stable page (updatedAt is a sort key only — liveness is derived, never read
 * from it). Returns every row annotated plus a live/reap-candidate summary.
 */
export async function loadCapsuleLivenessInventory(
  db: InventoryDb,
  args: { where: Record<string, unknown>; take: number },
  now: Date = new Date(),
): Promise<{ capsulesAll: Array<Record<string, unknown>>; livenessSummary: CapsuleLivenessSummary }> {
  const rows = await db.workroom.findMany({
    where: args.where,
    orderBy: { updatedAt: "desc" },
    take: args.take,
    select: INVENTORY_SELECT,
  });

  const buildIds = rows.map((r) => r.featureBuildId).filter((id): id is string => Boolean(id));
  const buildsById = new Map<string, { phase: string | null; lastActivityAt: Date | null }>();
  if (buildIds.length > 0) {
    const builds = await db.featureBuild.findMany({
      where: { id: { in: [...new Set(buildIds)] } },
      select: { id: true, phase: true, updatedAt: true },
    });
    for (const b of builds) {
      buildsById.set(b.id, { phase: b.phase ?? null, lastActivityAt: b.updatedAt ?? null });
    }
  }

  const leases = db.nonProductionEnvironmentLease
    ? await db.nonProductionEnvironmentLease.findMany({
      where: { status: { in: ["active", "queued"] }, expiresAt: { gt: now } },
      orderBy: [{ environmentKey: "asc" }, { queuedAt: "asc" }, { id: "asc" }],
      select: {
        leaseId: true, environmentKey: true, status: true, worktreePath: true, branchName: true,
        queuedAt: true, admittedAt: true, heartbeatAt: true, updatedAt: true,
      },
    })
    : [];
  const normalize = (value: unknown) => typeof value === "string"
    ? value.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase()
    : "";
  const leaseFor = (row: any) => leases.find((lease) =>
    (normalize(row.worktreePath) && normalize(lease.worktreePath) === normalize(row.worktreePath))
    || (normalize(row.headBranch) && normalize(lease.branchName) === normalize(row.headBranch)));

  const capsulesAll = rows.map((row) => {
    const featureBuild = row.featureBuildId ? buildsById.get(row.featureBuildId) ?? null : null;
    const lease = leaseFor(row);
    const verdict = classifyWorkCapsuleLiveness({
      ...row,
      featureBuild,
      durableWait: lease ? {
        state: lease.status,
        signaledAt: lease.heartbeatAt ?? lease.admittedAt ?? lease.queuedAt ?? lease.updatedAt ?? null,
      } : null,
    }, now);
    const { featureBuildId: _omit, taskRun: _taskRun, ...rest } = row;
    return {
      ...rest,
      recovery: projectWorkroomRecovery({ ...row, taskRun: row.taskRun }),
      liveness: verdict.liveness,
      isLive: verdict.isLive,
      isReapable: verdict.isReapable,
      disposition: verdict.disposition,
      livenessReason: verdict.reason,
      trueLivenessAt: verdict.trueLivenessAt ? verdict.trueLivenessAt.toISOString() : null,
    };
  });

  const byLiveness: Record<string, number> = {};
  for (const c of capsulesAll) byLiveness[c.liveness as string] = (byLiveness[c.liveness as string] ?? 0) + 1;

  const active = leases.filter((lease) => lease.status === "active");
  const queued = leases.filter((lease) => lease.status === "queued");
  const headByEnvironment = new Set<string>();
  for (const lease of queued) {
    if (!headByEnvironment.has(lease.environmentKey)) headByEnvironment.add(lease.environmentKey);
  }
  const transitionAges = leases.map((lease) => {
    const at = lease.heartbeatAt ?? lease.admittedAt ?? lease.queuedAt ?? lease.updatedAt;
    return at instanceof Date ? Math.max(0, now.getTime() - at.getTime()) : null;
  }).filter((age): age is number => age != null);
  const waitAges = queued.map((lease) => lease.queuedAt instanceof Date
    ? Math.max(0, now.getTime() - lease.queuedAt.getTime())
    : null).filter((age): age is number => age != null);

  return {
    capsulesAll,
    livenessSummary: {
      scanned: capsulesAll.length,
      live: capsulesAll.filter((c) => c.isLive).length,
      history: capsulesAll.filter((c) => !c.isLive).length,
      reapable: capsulesAll.filter((c) => c.isReapable).length,
      byLiveness,
      heavyLane: {
        executing: active.length,
        nextReady: headByEnvironment.size,
        dormant: Math.max(0, queued.length - headByEnvironment.size),
      },
      progressSlo: {
        oldestWaitMs: waitAges.length ? Math.max(...waitAges) : null,
        maxNoTransitionMs: transitionAges.length ? Math.max(...transitionAges) : null,
      },
    },
  };
}
