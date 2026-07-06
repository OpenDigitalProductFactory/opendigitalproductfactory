// apps/web/lib/portal-context/queue-awareness-resolver.ts
//
// EP-3516E23D Phase 3 — the PUSH half of queue visibility for coworkers. Turns
// at-risk queue snapshots into AttentionSignals injected into the coworker's
// portal context, so a coworker proactively knows "the field-service queue is
// backing up (14 waiting, oldest breaching SLA)" without being asked — the
// complement to the on-demand get_queue_status MCP tool. Spec §4.5.
//
// Best-effort: any failure yields no signals and never disturbs envelope
// assembly. The snapshot reader is injected so this is unit-testable without a DB.

import type { AttentionSignal } from "./types";
import type {
  QueueSnapshotView,
  QueueHealthAssessment,
  QueueSnapshotReadDeps,
} from "@/lib/queue/queue-snapshot-service";

/** Map a single at-risk queue to one attention signal. Pure. */
export function atRiskQueueToSignal(
  snapshot: QueueSnapshotView,
  assessment: QueueHealthAssessment,
): AttentionSignal {
  const reasons = assessment.reasons.length > 0 ? assessment.reasons.join(", ") : "backing up";
  return {
    kind: "queue_backpressure",
    severity: "warning",
    message: `Queue ${snapshot.queueKey} is at-risk: ${reasons}.`,
    actionLabel: "View queue metrics",
    actionHref: "/platform/ai/runtime-health",
  };
}

export interface ResolveQueueAttentionDeps extends QueueSnapshotReadDeps {
  readAtRiskQueues?: (
    deps?: QueueSnapshotReadDeps,
  ) => Promise<Array<{ snapshot: QueueSnapshotView; assessment: QueueHealthAssessment }>>;
  /** Cap the number of queue signals so a broad outage can't flood attention. */
  limit?: number;
}

/**
 * Resolve at-risk-queue attention signals for the coworker context. Returns []
 * on any failure. Caps output (default 5) so a platform-wide stall surfaces the
 * worst queues, not fifty rows.
 */
export async function resolveQueueAttention(
  deps: ResolveQueueAttentionDeps = {},
): Promise<AttentionSignal[]> {
  try {
    const read =
      deps.readAtRiskQueues ??
      (await import("@/lib/queue/queue-snapshot-service")).readAtRiskQueues;
    const atRisk = await read({ getFinder: deps.getFinder, now: deps.now });
    const limit = Math.min(Math.max(deps.limit ?? 5, 1), 20);
    return atRisk
      .slice(0, limit)
      .map(({ snapshot, assessment }) => atRiskQueueToSignal(snapshot, assessment));
  } catch (err) {
    console.warn(
      `[queue-awareness-resolver] failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return [];
  }
}
