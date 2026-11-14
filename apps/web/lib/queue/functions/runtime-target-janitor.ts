// BI-AD949172 — RuntimeTarget heartbeat sweep + NonProductionEnvironmentLease expiry.
//
// Runs hourly. Two coordination sweeps, followed by runtime fencing behind the
// normal quiescence gate. The five-minute nonprod wait owner also fences.
//
// 1. RuntimeTarget heartbeat sweep:
//    - status=running  + lastHeartbeatAt  older than STALE_RUNNING_HOURS  → expired
//    - status=planned  + createdAt        older than STALE_PLANNED_DAYS   → released
//    - status=starting + lastHeartbeatAt  older than STALE_RUNNING_HOURS  → expired
//    (verified / failed / released / expired rows are left untouched)
//
// 2. NonProductionEnvironmentLease expiry:
//    - expiresAt in the past + releasedAt IS NULL → set releasedAt + status=expired
//    (Leases with releasedAt already set are already closed; skip them.)

import { cron } from "@/lib/jobs/triggers";
import { jobs } from "@/lib/jobs";
import { prisma } from "@dpf/db";
import { reapExpiredNonprodEnvironmentLeases } from "@/lib/nonprod/environment-lease";
import { fenceEndedPreviewRuntimes } from "@/lib/nonprod/preview-runtime-fence";
import { gateAtEntry } from "../quiescence-gates";

const STALE_RUNNING_HOURS = 2;   // running/starting targets with no heartbeat
const STALE_PLANNED_DAYS  = 7;   // planned targets with no consumer ever started

export const runtimeTargetJanitor = jobs.createFunction(
  {
    id: "ops/runtime-target-janitor",
    retries: 1,
    // No concurrency constraint on purpose: if a prior run is still in flight
    // (e.g. a slow DB write) a second trigger is harmless — the WHERE clauses
    // are idempotent. Concurrency limit of 1 would queue triggers indefinitely.
    triggers: [cron("0 * * * *")], // every hour, on the hour
  },
  async ({ step }) => {
    const rtResult = await step.run("sweep-runtime-targets", sweepRuntimeTargets);
    const leaseResult = await step.run("expire-stale-leases", expireStaleLeases);
    const gate = await gateAtEntry(step, "ops/runtime-target-janitor");
    const previewFence = gate.proceed
      ? await step.run("fence-ended-preview-runtimes", () => fenceEndedPreviewRuntimes())
      : { skipped: true, reason: gate.reason };
    return { rtResult, leaseResult, previewFence };
  },
);

// ─── RuntimeTarget sweep ─────────────────────────────────────────────────────

type SweepRTResult = {
  expiredRunning: number;
  expiredStarting: number;
  releasedPlanned: number;
  skippedTotal: number;
};

async function sweepRuntimeTargets(): Promise<SweepRTResult> {
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - STALE_RUNNING_HOURS * 60 * 60 * 1000);
  const plannedCutoff = new Date(now.getTime() - STALE_PLANNED_DAYS * 24 * 60 * 60 * 1000);

  // Flip stale running/starting → expired.
  // lastHeartbeatAt IS NULL is also stale (was never heartbeated after registration).
  const [runningUpdate, startingUpdate] = await Promise.all([
    prisma.runtimeTarget.updateMany({
      where: {
        status: "running",
        OR: [
          { lastHeartbeatAt: { lt: staleCutoff } },
          { lastHeartbeatAt: null, updatedAt: { lt: staleCutoff } },
        ],
      },
      data: { status: "expired" },
    }),
    prisma.runtimeTarget.updateMany({
      where: {
        status: "starting",
        OR: [
          { lastHeartbeatAt: { lt: staleCutoff } },
          { lastHeartbeatAt: null, updatedAt: { lt: staleCutoff } },
        ],
      },
      data: { status: "expired" },
    }),
  ]);

  // Flip planned with no activity for STALE_PLANNED_DAYS → released.
  // Only targets that were never promoted past "planned" (i.e., status is still
  // "planned" after N days) are candidates. We do NOT flip ones that have a
  // future expiresAt — those were intentionally parked.
  const plannedUpdate = await prisma.runtimeTarget.updateMany({
    where: {
      status: "planned",
      createdAt: { lt: plannedCutoff },
      OR: [
        { expiresAt: null },
        { expiresAt: { lt: now } },
      ],
    },
    data: { status: "released" },
  });

  return {
    expiredRunning: runningUpdate.count,
    expiredStarting: startingUpdate.count,
    releasedPlanned: plannedUpdate.count,
    // informational: how many rows in terminal states we didn't touch
    skippedTotal: 0, // not queried for performance; set 0 to keep the shape
  };
}

// ─── NonProductionEnvironmentLease expiry ────────────────────────────────────

type ExpireLeaseResult = {
  expired: number;
};

async function expireStaleLeases(): Promise<ExpireLeaseResult> {
  // Single source of truth: the reaper the lease lib also exposes for unit tests
  // and on-demand callers (BI-4043A64B). Catches crashed/killed sessions whose
  // lease never got an explicit release_nonprod_environment_lease (gate-worktree.sh
  // releases on clean completion), and is the safety net for a holder that
  // stopped heartbeating (renew) — a long/stuck process can't lock the single
  // shared instance because its lapsed lease is swept here.
  const { reaped } = await reapExpiredNonprodEnvironmentLeases();
  return { expired: reaped };
}
