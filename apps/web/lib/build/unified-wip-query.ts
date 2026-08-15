// apps/web/lib/build/unified-wip-query.ts
//
// BI-937128F6 / EP-UNIFIED-TRACKING — the DB read that feeds the unified,
// pool-aware WIP cap. unified-wip.ts is intentionally PURE (no DB import); this
// module is its data-loading companion: it reads active WIP across ALL delivery
// surfaces and returns the classified UnifiedWipSummary that the enforced cap
// (wip-cap.ts decideUnifiedWip / assertUnifiedWipCapacity) gates on.
//
// Why bs-sandbox pressure comes from FeatureBuild, not build-studio capsules:
//   A build-studio Workroom is created in "working" status
//   (work-capsules/build-studio-attachment.ts) and its status is NOT transitioned
//   to a terminal value when the build finishes — capture-build-pr.ts stamps the
//   PR onto the capsule but leaves its status "working". Counting build-studio
//   capsules would therefore over-count finished builds and wrongly TIGHTEN the
//   sandbox cap. FeatureBuild.phase is the authoritative record of sandbox
//   occupancy, and ONLY build-studio work contends on the sandbox
//   (unified-wip.contendsOnBsSandbox), so sourcing bs-sandbox pressure from the
//   active FeatureBuild count keeps the BS gate byte-for-byte as it is today.
//   Every OTHER surface registers a Workroom, which IS the authoritative unit
//   of WIP for the non-sandbox pools (shared-lease / host-worktree).

import {
  summarizeUnifiedWip,
  type ActiveWipItem,
  type UnifiedWipSummary,
  type WipPool,
} from "./unified-wip";
import { TERMINAL_BUILD_PHASES } from "./wip-cap";

/**
 * Capsule statuses that have RELEASED their resource pool — a capsule in one of
 * these no longer occupies a WIP slot. Mirrors TERMINAL_CAPSULE_STATUSES in
 * work-capsules/work-capsule-store.ts; kept in lockstep with that list.
 */
export const TERMINAL_CAPSULE_STATUSES = ["complete", "abandoned", "archived"] as const;

/** Minimal duck-typed DB surface — kept structural so it mocks trivially. */
export interface UnifiedWipDb {
  featureBuild: {
    count(args: unknown): Promise<number>;
  };
  workroom: {
    findMany(args: unknown): Promise<
      Array<{
        executorKind: string | null;
        worktreePath: string | null;
        headBranch: string | null;
      }>
    >;
  };
  nonProductionEnvironmentLease: {
    findMany(args: unknown): Promise<
      Array<{ worktreePath: string | null; branchName: string | null }>
    >;
  };
}

/**
 * Read active WIP across every surface and classify it by the finite resource
 * pool it contends on.
 *
 * - bs-sandbox pressure  = active FeatureBuilds (authoritative; see file header).
 * - non-BS active capsules = the other surfaces' WIP; each is tagged
 *   holdsSharedLease when it matches an active :3001 nonprod lease (by worktree
 *   path or branch), so runtime-bound external work classifies as shared-lease
 *   and everything else as host-worktree.
 */
export async function loadActiveUnifiedWip(
  db: UnifiedWipDb,
  now: Date = new Date(),
): Promise<UnifiedWipSummary> {
  const [activeBsBuilds, capsules, activeLeases] = await Promise.all([
    db.featureBuild.count({
      where: {
        phase: { notIn: [...TERMINAL_BUILD_PHASES] },
        abandonedAt: null,
        parentEpicId: null,
      },
    }),
    db.workroom.findMany({
      where: {
        status: { notIn: [...TERMINAL_CAPSULE_STATUSES] },
        archivedAt: null,
        // BS occupancy is tracked authoritatively via FeatureBuild (header);
        // exclude build-studio capsules here to avoid double-counting.
        executorKind: { not: "build-studio" },
      },
      select: { executorKind: true, worktreePath: true, headBranch: true },
    }),
    db.nonProductionEnvironmentLease.findMany({
      where: { status: "active", expiresAt: { gt: now } },
      select: { worktreePath: true, branchName: true },
    }),
  ]);

  const leasedWorktrees = new Set(
    activeLeases.map((l) => l.worktreePath).filter((v): v is string => Boolean(v)),
  );
  const leasedBranches = new Set(
    activeLeases.map((l) => l.branchName).filter((v): v is string => Boolean(v)),
  );

  const items: ActiveWipItem[] = [
    // bs-sandbox contenders — one item per active BS build.
    ...Array.from({ length: activeBsBuilds }, () => ({ executorKind: "build-studio" })),
    // every other surface — one item per active Workroom.
    ...capsules.map((c) => ({
      executorKind: c.executorKind ?? "dpf-native",
      holdsSharedLease:
        (c.worktreePath != null && leasedWorktrees.has(c.worktreePath)) ||
        (c.headBranch != null && leasedBranches.has(c.headBranch)),
    })),
  ];

  return summarizeUnifiedWip(items);
}

/** The active WIP pressure on a given pool, read from a unified summary. */
export function poolPressure(summary: UnifiedWipSummary, pool: WipPool): number {
  switch (pool) {
    case "bs-sandbox":
      return summary.bsSandboxContending;
    case "shared-lease":
      return summary.sharedLeaseContending;
    case "host-worktree":
      return summary.hostWorktreeOnly;
    case "none":
      return 0;
  }
}
