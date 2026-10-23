import type { prisma } from "@dpf/db";
import type { LeaseRow } from "./environment-lease-result";
import { checkpointImmediateNonprodLeaseAdmission } from "./durable-wait";

/** Called inside the lease transaction, never as a backfill or ownership transfer. */
export async function bindFreshImmediateLeaseProvenance(input: {
  db: Pick<typeof prisma, "nonProductionEnvironmentLease"> & Partial<Pick<typeof prisma, "taskRun">>;
  lease: LeaseRow;
  created: boolean;
  authenticatedUserId?: string;
  waitDeadlineAt: Date;
  now: Date;
}): Promise<LeaseRow> {
  const { lease } = input;
  if (!input.created || !input.authenticatedUserId || lease.status !== "active" || !lease.slotKey
    || lease.environmentKey !== "local-integration-ci"
    || lease.slotManifestVersion !== 1 || lease.taskRunId) return lease;
  if (!input.db.taskRun) throw new Error("nonprod_immediate_admission_task_store_unavailable");
  const taskRunId = await checkpointImmediateNonprodLeaseAdmission({
    db: { nonProductionEnvironmentLease: input.db.nonProductionEnvironmentLease, taskRun: input.db.taskRun },
    userId: input.authenticatedUserId, lease, waitDeadlineAt: input.waitDeadlineAt, now: input.now,
  });
  return { ...lease, taskRunId };
}
