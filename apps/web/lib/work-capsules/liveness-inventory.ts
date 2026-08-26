// apps/web/lib/work-capsules/liveness-inventory.ts
//
// WS9 (BI-CBAAEA94): the read-side of the liveness contract. Loads a page of
// WorkCapsules, joins each build-studio capsule's linked FeatureBuild (its only
// real liveness signal — phase + activity, never the frozen-at-14:00 updatedAt),
// and annotates every row with its true-liveness verdict plus a summary. Shared
// by the `list_work_capsules` MCP tool so the handler stays thin.

import { classifyWorkCapsuleLiveness } from "./liveness";

const INVENTORY_SELECT = {
  capsuleId: true,
  title: true,
  status: true,
  source: true,
  executorKind: true,
  decisionScope: true,
  portfolioRole: true,
  servedPersona: true,
  activityKind: true,
  outcomeAnchor: true,
  servesPortfolioRoles: true,
  dependsOnPortfolioRoles: true,
  headBranch: true,
  worktreePath: true,
  pullRequestUrl: true,
  pullRequestNumber: true,
  leaseExpiresAt: true,
  lastSyncedAt: true,
  updatedAt: true,
  featureBuildId: true,
} as const;

type InventoryDb = {
  workroom: { findMany(args: unknown): Promise<any[]> };
  featureBuild: { findMany(args: unknown): Promise<any[]> };
};

export type CapsuleLivenessSummary = {
  scanned: number;
  live: number;
  history: number;
  reapable: number;
  byLiveness: Record<string, number>;
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

  const capsulesAll = rows.map((row) => {
    const featureBuild = row.featureBuildId ? buildsById.get(row.featureBuildId) ?? null : null;
    const verdict = classifyWorkCapsuleLiveness({ ...row, featureBuild }, now);
    const { featureBuildId: _omit, ...rest } = row;
    return {
      ...rest,
      liveness: verdict.liveness,
      isLive: verdict.isLive,
      isReapable: verdict.isReapable,
      livenessReason: verdict.reason,
      trueLivenessAt: verdict.trueLivenessAt ? verdict.trueLivenessAt.toISOString() : null,
    };
  });

  const byLiveness: Record<string, number> = {};
  for (const c of capsulesAll) byLiveness[c.liveness as string] = (byLiveness[c.liveness as string] ?? 0) + 1;

  return {
    capsulesAll,
    livenessSummary: {
      scanned: capsulesAll.length,
      live: capsulesAll.filter((c) => c.isLive).length,
      history: capsulesAll.filter((c) => !c.isLive).length,
      reapable: capsulesAll.filter((c) => c.isReapable).length,
      byLiveness,
    },
  };
}
