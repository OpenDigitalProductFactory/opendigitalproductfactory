import { randomUUID } from "node:crypto";
import { prisma } from "@dpf/db";

export type NonprodEnvironmentKey = "active-candidate" | "local-integration-ci";
/** Host-worktree coding surfaces + BS/coworker that may claim a shared nonprod lease. */
export type NonprodOwnerProvider =
  | "build-studio"
  | "claude"
  | "codex"
  | "grok"
  | "antigravity"
  | "coworker";

export const NONPROD_OWNER_PROVIDERS: readonly NonprodOwnerProvider[] = [
  "build-studio",
  "claude",
  "codex",
  "grok",
  "antigravity",
  "coworker",
] as const;

type LeaseDb = Pick<typeof prisma, "nonProductionEnvironmentLease">;

// BI-4043A64B — anti-monopolization for the single shared nonprod instance.
// A lease can never be held longer than MAX_LEASE_TTL_MS without an active
// heartbeat (renew). One stuck/long-running process therefore cannot lock the
// instance for everyone else: if it stops renewing (crash, stall, a long batch
// job that forgot to heartbeat), the lease expires and is reclaimed/reaped.
// The shared lease is for SHORT interactive integration/UX windows; long jobs
// run on an ephemeral isolated runtime, not this lease.
export const MAX_LEASE_TTL_MS = 20 * 60_000; // hard cap per claim/renew window
export const DEFAULT_LEASE_TTL_MS = 15 * 60_000; // default interactive window

/**
 * Clamp a requested expiry to at most `now + MAX_LEASE_TTL_MS`. A caller asking
 * for an hours-long hold is capped to the max window; it must heartbeat (renew)
 * to keep the lease. A missing request defaults to `now + ttlMs`.
 */
export function clampLeaseExpiry(
  now: Date,
  requested: Date | undefined,
  ttlMs: number = DEFAULT_LEASE_TTL_MS,
): Date {
  const cap = now.getTime() + MAX_LEASE_TTL_MS;
  const want = (requested ?? new Date(now.getTime() + ttlMs)).getTime();
  return new Date(Math.min(want, cap));
}

function createLeaseId() {
  return `NPEL-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
}

/**
 * Prisma throws PrismaClientKnownRequestError { code: "P2002" } when a unique
 * index rejects a write. Duck-typed so this module stays decoupled from the
 * client import and the check is trivially mockable in unit tests.
 */
function isUniqueConstraintViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "P2002"
  );
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
  const now = input.now ?? new Date();

  // Fast path: an already-active, unexpired lease for this key is a conflict.
  const active = await db.nonProductionEnvironmentLease.findFirst({
    where: {
      environmentKey: input.environmentKey,
      status: "active",
      expiresAt: { gt: now },
    },
  });
  if (active) return { status: "conflict" as const, active };

  // Self-heal: free any lapsed-but-still-"active" row for this key so its
  // single-active slot (activeKey) is released before we claim. Without this,
  // the unique index would block a legitimate claim on an env whose previous
  // holder already expired but has not been reaped yet.
  await db.nonProductionEnvironmentLease.updateMany({
    where: {
      environmentKey: input.environmentKey,
      status: "active",
      expiresAt: { lte: now },
    },
    data: { status: "expired", activeKey: null, releasedAt: now },
  });

  // The create is the atomic gate: a UNIQUE index on `activeKey` (= the env key
  // while active) means only ONE concurrent claim can succeed. The findFirst
  // above is a fast path, not the guarantee — two sessions can both pass it,
  // but only one create wins. The loser catches P2002 and reports the conflict
  // instead of a 500. This closes the claim TOCTOU on the single shared nonprod
  // instance (two sessions both believing they own :3001 / active-candidate).
  try {
    const lease = await db.nonProductionEnvironmentLease.create({
      data: {
        leaseId: createLeaseId(),
        environmentKey: input.environmentKey,
        activeKey: input.environmentKey,
        ownerProvider: input.ownerProvider,
        ownerSessionId: input.ownerSessionId,
        purpose: input.purpose,
        url: input.url,
        ports: input.ports,
        // Cap the hold window (BI-4043A64B); longer holds require heartbeat renew.
        expiresAt: clampLeaseExpiry(now, input.expiresAt),
        worktreePath: input.worktreePath,
        branchName: input.branchName,
        buildId: input.buildId,
        taskRunId: input.taskRunId,
        cleanupCommand: input.cleanupCommand,
      },
    });
    return { status: "claimed" as const, lease };
  } catch (err) {
    if (isUniqueConstraintViolation(err)) {
      const winner = await db.nonProductionEnvironmentLease.findFirst({
        where: {
          environmentKey: input.environmentKey,
          status: "active",
          expiresAt: { gt: now },
        },
      });
      if (winner) return { status: "conflict" as const, active: winner };
    }
    throw err;
  }
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
      // Free the single-active slot so a new claim for this env can succeed.
      activeKey: null,
    },
  });
}

/**
 * Heartbeat: extend an active lease's hold window (BI-4043A64B). Only the owning
 * session can renew, and only while the lease is still active and unexpired — a
 * lease that already lapsed is NOT revivable (the holder lost it; it may have
 * been reclaimed by another waiter), forcing an honest re-claim. The new expiry
 * is clamped to the max window, so renewing does not grant an unbounded hold.
 */
export async function renewNonprodEnvironmentLease(input: {
  db?: LeaseDb;
  leaseId: string;
  ownerSessionId: string;
  ttlMs?: number;
  now?: Date;
}): Promise<
  | { status: "renewed"; lease: Awaited<ReturnType<LeaseDb["nonProductionEnvironmentLease"]["update"]>> }
  | { status: "lost"; reason: "not-found" | "not-active" | "not-owner" | "expired" }
> {
  const db = input.db ?? prisma;
  const now = input.now ?? new Date();
  const lease = await db.nonProductionEnvironmentLease.findUnique({
    where: { leaseId: input.leaseId },
  });
  if (!lease) return { status: "lost", reason: "not-found" };
  if (lease.status !== "active") return { status: "lost", reason: "not-active" };
  if (lease.ownerSessionId !== input.ownerSessionId) return { status: "lost", reason: "not-owner" };
  if (lease.expiresAt.getTime() <= now.getTime()) return { status: "lost", reason: "expired" };

  const updated = await db.nonProductionEnvironmentLease.update({
    where: { leaseId: input.leaseId },
    data: { expiresAt: clampLeaseExpiry(now, undefined, input.ttlMs) },
  });
  return { status: "renewed", lease: updated };
}

/**
 * Reaper: mark every active-but-expired lease as `expired` and stamp
 * `releasedAt` (BI-4043A64B). The claim/list queries already ignore expired
 * leases, so this is hygiene + audit + freeing the env for the next waiter —
 * the scheduled counterpart to the RuntimeTarget heartbeat sweep. Returns the
 * count reaped. Idempotent.
 */
export async function reapExpiredNonprodEnvironmentLeases(input: {
  db?: LeaseDb;
  now?: Date;
} = {}): Promise<{ reaped: number }> {
  const db = input.db ?? prisma;
  const now = input.now ?? new Date();
  const res = await db.nonProductionEnvironmentLease.updateMany({
    where: { status: "active", expiresAt: { lt: now }, releasedAt: null },
    // Free the single-active slot (activeKey) as part of reaping.
    data: { status: "expired", releasedAt: now, activeKey: null },
  });
  return { reaped: res.count };
}
