// apps/web/lib/backlog/claim-on-start.ts
//
// Atomic BacklogItem claim-on-start (BI-B62B9F1E / concurrency analysis R5).
//
// The previous gate read claim freshness then UPDATEd inside a transaction —
// two sessions could both pass the pre-transaction check and both claim
// (classic TOCTOU). The fix mirrors NonProductionEnvironmentLease: the
// database row update IS the gate. Concurrent UPDATEs on the same row
// serialize; the loser's WHERE no longer matches and count stays 0.
//
// Shape (single BacklogItem row, not a lease CREATE):
//   UPDATE ... WHERE id = $id AND (claim free | stale | owned-by-caller | force)
//   → count === 1 win, count === 0 conflict
//
// Stale claims (older than STALE_BACKLOG_CLAIM_MS) are reclaimable inline and
// are also swept by reapStaleBacklogClaims so dead-session "active" rows do
// not linger as operator noise.

export const STALE_BACKLOG_CLAIM_MS = 12 * 60 * 60 * 1000;

export type BacklogClaimSnapshot = {
  claimStatus: string | null;
  claimedById: string | null;
  claimedByAgentId: string | null;
  claimedAt: Date | string | null;
};

export type ClaimAcquireInput = {
  userId: string;
  agentId: string | null;
  force?: boolean;
  now?: Date;
};

/**
 * Pure predicate: does this snapshot represent a fresh active claim held by
 * someone other than the caller? Used by unit tests and advisory pre-checks;
 * the atomic write path does not rely on it for correctness.
 */
export function isActivelyClaimedByOther(
  snapshot: BacklogClaimSnapshot,
  input: ClaimAcquireInput,
): boolean {
  if (snapshot.claimStatus !== "active") return false;
  if (!snapshot.claimedById && !snapshot.claimedByAgentId) return false;
  const claimedAtMs = snapshot.claimedAt ? new Date(snapshot.claimedAt).getTime() : 0;
  const nowMs = (input.now ?? new Date()).getTime();
  if (!claimedAtMs || nowMs - claimedAtMs >= STALE_BACKLOG_CLAIM_MS) return false;
  const ownedByCaller =
    (snapshot.claimedById != null && snapshot.claimedById === input.userId) ||
    (snapshot.claimedByAgentId != null &&
      input.agentId != null &&
      snapshot.claimedByAgentId === input.agentId);
  return !ownedByCaller;
}

/**
 * Prisma WHERE for the atomic claim UPDATE. Exported for unit tests so the
 * race-safe predicate is pinned without needing a live DB.
 *
 * Wins when:
 *  - force=true (takeover), OR
 *  - claim is not active / null / released, OR
 *  - claim is stale (claimedAt older than STALE), OR
 *  - claim is already owned by this user or agent (re-entry)
 */
export function buildAtomicClaimWhere(
  itemRowId: string,
  input: ClaimAcquireInput,
): Record<string, unknown> {
  if (input.force) {
    return { id: itemRowId };
  }
  const now = input.now ?? new Date();
  const staleBefore = new Date(now.getTime() - STALE_BACKLOG_CLAIM_MS);
  const ownershipBranches: Record<string, unknown>[] = [
    { claimedById: input.userId },
  ];
  if (input.agentId) {
    ownershipBranches.push({ claimedByAgentId: input.agentId });
  }
  return {
    id: itemRowId,
    OR: [
      { claimStatus: null },
      { claimStatus: { not: "active" } },
      { claimedAt: null },
      { claimedAt: { lt: staleBefore } },
      { AND: [{ claimStatus: "active" }, { OR: ownershipBranches }] },
    ],
  };
}

export type ClaimAcquireData = {
  claimStatus: "active";
  claimedById: string;
  claimedByAgentId: string | null;
  claimedAt: Date;
};

export function buildClaimAcquireData(input: ClaimAcquireInput): ClaimAcquireData {
  return {
    claimStatus: "active",
    claimedById: input.userId,
    claimedByAgentId: input.agentId,
    claimedAt: input.now ?? new Date(),
  };
}

/** Minimal DB surface used by the atomic acquire (prisma or transaction client). */
export type BacklogClaimDb = {
  backlogItem: {
    updateMany: (args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => Promise<{ count: number }>;
    findUnique: (args: {
      where: { id: string };
      select: {
        claimStatus: true;
        claimedById: true;
        claimedByAgentId: true;
        claimedAt: true;
      };
    }) => Promise<BacklogClaimSnapshot | null>;
  };
};

export type AtomicClaimResult =
  | { ok: true; forced: boolean; reentered?: boolean }
  | {
      ok: false;
      error: "claim_conflict";
      claimedById: string | null;
      claimedByAgentId: string | null;
      claimedAt: Date | string | null;
      claimAgeMinutes: number | null;
    };

/**
 * Atomically acquire (or re-enter / force-take) the claim on one BacklogItem.
 * Returns ok:false when another session holds a fresh active claim and force
 * was not set — callers map that to error=claim_conflict.
 */
export async function tryAcquireBacklogClaimAtomic(params: {
  db: BacklogClaimDb;
  itemRowId: string;
  userId: string;
  agentId: string | null;
  force?: boolean;
  now?: Date;
}): Promise<AtomicClaimResult> {
  const input: ClaimAcquireInput = {
    userId: params.userId,
    agentId: params.agentId,
    force: params.force === true,
    now: params.now,
  };
  // BI-05F8860A: re-entry by the owner of a fresh active claim must NOT rewrite
  // claimedAt. claimedAt opens the completion-evidence window, so bumping it on
  // every claim_backlog_item_for_work silently invalidated every evidence row
  // recorded before the re-claim. Same owner, same item, live claim: keep it.
  let reentered = false;
  if (!input.force) {
    const now = input.now ?? new Date();
    const staleBefore = new Date(now.getTime() - STALE_BACKLOG_CLAIM_MS);
    const ownershipBranches: Record<string, unknown>[] = [{ claimedById: input.userId }];
    if (input.agentId) ownershipBranches.push({ claimedByAgentId: input.agentId });
    const reentry = await params.db.backlogItem.updateMany({
      where: {
        id: params.itemRowId,
        claimStatus: "active",
        claimedAt: { gte: staleBefore },
        OR: ownershipBranches,
      },
      data: { claimStatus: "active", claimedById: input.userId, claimedByAgentId: input.agentId },
    });
    reentered = reentry.count > 0;
  }
  const where = buildAtomicClaimWhere(params.itemRowId, input);
  const data = buildClaimAcquireData(input);
  const result = reentered ? { count: 1 } : await params.db.backlogItem.updateMany({ where, data });
  if (result.count > 0) {
    return { ok: true, forced: input.force === true, ...(reentered ? { reentered } : {}) };
  }

  const current = await params.db.backlogItem.findUnique({
    where: { id: params.itemRowId },
    select: {
      claimStatus: true,
      claimedById: true,
      claimedByAgentId: true,
      claimedAt: true,
    },
  });
  const claimedAt = current?.claimedAt ?? null;
  const claimAgeMinutes =
    claimedAt != null
      ? Math.round((Date.now() - new Date(claimedAt).getTime()) / 60_000)
      : null;
  return {
    ok: false,
    error: "claim_conflict",
    claimedById: current?.claimedById ?? null,
    claimedByAgentId: current?.claimedByAgentId ?? null,
    claimedAt,
    claimAgeMinutes,
  };
}

/**
 * Sweep active claims older than the stale window to claimStatus=released.
 * Complements the inline reclaim path so dead-session claims do not linger.
 */
export async function reapStaleBacklogClaims(params: {
  db: {
    backlogItem: {
      updateMany: (args: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => Promise<{ count: number }>;
    };
  };
  now?: Date;
}): Promise<{ reaped: number }> {
  const now = params.now ?? new Date();
  const staleBefore = new Date(now.getTime() - STALE_BACKLOG_CLAIM_MS);
  const result = await params.db.backlogItem.updateMany({
    where: {
      claimStatus: "active",
      claimedAt: { lt: staleBefore },
    },
    data: {
      claimStatus: "released",
    },
  });
  return { reaped: result.count };
}
