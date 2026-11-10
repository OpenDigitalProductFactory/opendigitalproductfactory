// Dead letters on queue health (BI-BC5C47D4, design
// docs/superpowers/specs/2026-10-07-durable-delegation-ledger-design.md §4.2).
//
// BI-6BB830E4 bounded two retry paths; this makes what they gave up on visible.
// - Job engine: a run every attempt of which lost its lease ends `failed` with
//   an error starting `lease_expired_exhausted`.
// - Async-operation outbox: a transition still undelivered at the attempt cap
//   is no longer selected.
// Read-only: nothing here re-drives anything.

import { prisma } from "@dpf/db";
import { ASYNC_OPERATION_TRANSITION_DELIVERY_CAP } from "@/lib/inference/async-operation-outbox";

export type DeadLetterSource = {
  queueKey: string;
  label: string;
  count: number;
  latest: { at: string; reason: string; detail: string | null } | null;
};

/** Retention of finished job runs bounds how far back the engine count reaches. */
const JOB_EXHAUSTED_PREFIX = "lease_expired_exhausted";

type DeadLetterDb = {
  jobRun: {
    count(args: unknown): Promise<number>;
    findFirst(args: unknown): Promise<{ functionKey: string; error: string | null; finishedAt: Date | null } | null>;
  };
  asyncInferenceOperationTransition: {
    count(args: unknown): Promise<number>;
    findFirst(args: unknown): Promise<{ operationId: string; sequence: number; occurredAt: Date } | null>;
  };
};

export async function readDeadLetters(db: DeadLetterDb = prisma as unknown as DeadLetterDb): Promise<DeadLetterSource[]> {
  const jobWhere = { status: "failed", error: { startsWith: JOB_EXHAUSTED_PREFIX } };
  const outboxWhere = { deliveredAt: null, deliveryAttempts: { gte: ASYNC_OPERATION_TRANSITION_DELIVERY_CAP } };
  const [jobCount, jobLatest, outboxCount, outboxLatest] = await Promise.all([
    db.jobRun.count({ where: jobWhere }),
    db.jobRun.findFirst({ where: jobWhere, orderBy: { finishedAt: "desc" }, select: { functionKey: true, error: true, finishedAt: true } }),
    db.asyncInferenceOperationTransition.count({ where: outboxWhere }),
    db.asyncInferenceOperationTransition.findFirst({
      where: outboxWhere,
      orderBy: { occurredAt: "desc" },
      select: { operationId: true, sequence: true, occurredAt: true },
    }),
  ]);
  return [
    {
      queueKey: "dead-letter:job-engine",
      label: "Job runs that lost their lease on every attempt",
      count: jobCount,
      latest: jobLatest
        ? { at: (jobLatest.finishedAt ?? new Date(0)).toISOString(), reason: jobLatest.functionKey, detail: jobLatest.error }
        : null,
    },
    {
      queueKey: "dead-letter:async-operation-outbox",
      label: `Async-operation transitions undelivered after ${ASYNC_OPERATION_TRANSITION_DELIVERY_CAP} attempts`,
      count: outboxCount,
      latest: outboxLatest
        ? { at: outboxLatest.occurredAt.toISOString(), reason: `operation ${outboxLatest.operationId}`, detail: `transition ${outboxLatest.sequence}` }
        : null,
    },
  ];
}
