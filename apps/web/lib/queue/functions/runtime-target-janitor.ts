// BI-AD949172 — RuntimeTarget heartbeat sweep + NonProductionEnvironmentLease expiry.
//
// Runs hourly. Two fast sweeps, no quiescence gate (reads + writes to coordination
// records, not portal state):
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

import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { prisma } from "@dpf/db";

const STALE_RUNNING_HOURS = 2;   // running/starting targets with no heartbeat
const STALE_PLANNED_DAYS  = 7;   // planned targets with no consumer ever started

export const runtimeTargetJanitor = inngest.createFunction(
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
    return { rtResult, leaseResult };
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
  const now = new Date();

  // Any lease whose expiresAt has passed and releasedAt is still null is orphaned.
  // The gate-worktree.sh script explicitly calls release_nonprod_environment_lease
  // on completion; this sweep catches crashes or sessions that were killed.
  const update = await prisma.nonProductionEnvironmentLease.updateMany({
    where: {
      expiresAt: { lt: now },
      releasedAt: null,
      // Only sweep "active" leases. Leases already in a terminal state
      // (released, expired) are fine as-is; don't touch them.
      status: "active",
    },
    data: {
      status: "expired",
      releasedAt: now,
    },
  });

  return { expired: update.count };
}
