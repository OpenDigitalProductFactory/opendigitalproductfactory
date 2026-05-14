import { STALE_CACHE_MS } from "@/lib/work-capsules";

type CapsuleRowInput = {
  capsuleId: string;
  title: string;
  status: string;
  source: string;
  executorKind: string | null;
  headBranch: string | null;
  worktreePath: string | null;
  pullRequestUrl: string | null;
  leaseExpiresAt: Date | null;
  lastSyncedAt: Date | null;
  updatedAt: Date;
};

export type PresentedCapsuleRow = ReturnType<typeof presentCapsuleRow>;

export function presentCapsuleRow(row: CapsuleRowInput, now = new Date()) {
  const leaseExpired = row.leaseExpiresAt != null && row.leaseExpiresAt.getTime() < now.getTime();
  const staleCache = row.lastSyncedAt != null && now.getTime() - row.lastSyncedAt.getTime() > STALE_CACHE_MS;

  return {
    capsuleId: row.capsuleId,
    title: row.title,
    status: row.status,
    source: row.source,
    executorKind: row.executorKind ?? "unassigned",
    branch: row.headBranch ?? "no branch",
    worktreePath: row.worktreePath,
    pullRequestUrl: row.pullRequestUrl,
    health: leaseExpired ? "lease-expired" : staleCache ? "stale-cache" : "ok",
    updatedAt: row.updatedAt.toISOString(),
  };
}
