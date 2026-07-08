// apps/web/lib/queue/queue-telemetry.ts
//
// EP-3516E23D Phase 1 — the single fire-and-forget writer every queue calls to
// record a lifecycle transition into the shared flow-telemetry spine. Spec §4.2.
//
// Two effects, both best-effort and NEVER allowed to throw into the caller's
// path (same discipline as recordCoworkerTurnMetric): (1) append a
// QueueTelemetryEvent row (the durable stream the rollup aggregates), and
// (2) mirror the transition to Prometheus so the existing monitoring profile
// graphs it with zero new infra. Real-time queue:* event-bus emission and the
// coworker MCP surface land in Phase 3 (visibility) — this phase produces the
// data those surfaces read.
//
// The Prisma delegate and the Prometheus mirror are dependency-injected so unit
// tests exercise the branching without pulling the generated @dpf/db client or
// prom-client into the module graph — mirroring coworker-turn-metrics.ts.

import type { QueueTransition, QueueOutcome } from "./flow-metrics";
import { getErrorMessage } from "@/lib/shared/get-error-message";

export interface QueueTransitionInput {
  /** Stable queue identifier, e.g. "cwq:triage-default" | "compute:sandbox-pool". */
  queueKey: string;
  /** "work-item" | "sandbox-slot" | "inference" | ... */
  itemKind: string;
  /** Source record id (WorkItem.itemId, buildId, ...). */
  itemId: string;
  transition: QueueTransition;
  /** Terminal outcome — set on finished/cancelled. */
  outcome?: QueueOutcome | null;
  laneKey?: string | null;
  actorType?: "human" | "ai-agent" | "system" | null;
  actorId?: string | null;
  occurredAt?: Date;
  /**
   * Pre-computed flow durations for the Prometheus mirror, supplied when the
   * caller cheaply knows the prior timestamps (e.g. a sandbox release knows
   * acquiredAt; a work-item completion knows createdAt/claimedAt). Durations are
   * always recoverable from the event stream at rollup time regardless — this
   * only feeds the live histograms.
   */
  durations?: {
    waitMs?: number | null;
    processMs?: number | null;
    cycleMs?: number | null;
  };
  /** Instantaneous queued depth to publish to the gauge, when known. */
  depth?: number | null;
}

/** Structural contract for the Prisma delegate this writer touches. */
export type QueueTelemetryCreator = {
  create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
};

/** Prometheus mirror surface — injected so tests need not load prom-client. */
export interface QueueMetricsMirror {
  arrivals(queueKey: string): void;
  throughput(queueKey: string, outcome: QueueOutcome): void;
  depth(queueKey: string, value: number): void;
  waitSeconds(queueKey: string, seconds: number): void;
  processSeconds(queueKey: string, outcome: QueueOutcome, seconds: number): void;
  cycleSeconds(queueKey: string, seconds: number): void;
}

export interface RecordQueueTransitionDeps {
  getCreator?: () => Promise<QueueTelemetryCreator>;
  getMirror?: () => Promise<QueueMetricsMirror>;
}

function strOrNull(v: string | null | undefined): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

async function defaultGetCreator(): Promise<QueueTelemetryCreator> {
  const { prisma } = await import("@dpf/db");
  return prisma.queueTelemetryEvent as unknown as QueueTelemetryCreator;
}

async function defaultGetMirror(): Promise<QueueMetricsMirror> {
  const m = await import("@/lib/operate/metrics");
  return {
    arrivals: (queueKey) => m.queueArrivalsTotal.inc({ queue_key: queueKey }),
    throughput: (queueKey, outcome) =>
      m.queueThroughputTotal.inc({ queue_key: queueKey, outcome }),
    depth: (queueKey, value) => m.queueDepth.set({ queue_key: queueKey }, value),
    waitSeconds: (queueKey, seconds) =>
      m.queueWaitSeconds.observe({ queue_key: queueKey }, seconds),
    processSeconds: (queueKey, outcome, seconds) =>
      m.queueProcessSeconds.observe({ queue_key: queueKey, outcome }, seconds),
    cycleSeconds: (queueKey, seconds) =>
      m.queueCycleSeconds.observe({ queue_key: queueKey }, seconds),
  };
}

/**
 * Apply the Prometheus effects for a transition. Pure over the injected mirror
 * (no I/O of its own) so the transition→metric mapping is unit-testable. A
 * `finished`/`cancelled` records throughput; durations observed when provided;
 * `enqueued` counts an arrival; depth published whenever supplied.
 */
export function mirrorQueueTransition(
  input: QueueTransitionInput,
  mirror: QueueMetricsMirror,
): void {
  const { queueKey } = input;

  if (typeof input.depth === "number" && Number.isFinite(input.depth)) {
    mirror.depth(queueKey, input.depth);
  }

  if (input.transition === "enqueued") {
    mirror.arrivals(queueKey);
  }

  if (input.transition === "finished" || input.transition === "cancelled") {
    const outcome: QueueOutcome =
      input.outcome ?? (input.transition === "cancelled" ? "cancelled" : "success");
    mirror.throughput(queueKey, outcome);

    const d = input.durations;
    if (d) {
      if (typeof d.waitMs === "number" && d.waitMs >= 0) {
        mirror.waitSeconds(queueKey, d.waitMs / 1000);
      }
      if (typeof d.processMs === "number" && d.processMs >= 0) {
        mirror.processSeconds(queueKey, outcome, d.processMs / 1000);
      }
      if (typeof d.cycleMs === "number" && d.cycleMs >= 0) {
        mirror.cycleSeconds(queueKey, d.cycleMs / 1000);
      }
    }
  }
}

/**
 * Record one queue transition. Fire-and-forget safe: on ANY failure it catches,
 * warns, and resolves without throwing — queue observability must never break
 * the work it observes. Call as `void recordQueueTransition({...})`.
 */
export async function recordQueueTransition(
  input: QueueTransitionInput,
  deps?: RecordQueueTransitionDeps,
): Promise<void> {
  try {
    const queueKey = strOrNull(input.queueKey);
    const itemKind = strOrNull(input.itemKind);
    const itemId = strOrNull(input.itemId);
    // Without these three there is no locatable event — skip rather than write
    // an un-attributable orphan row.
    if (!queueKey || !itemKind || !itemId) return;

    const getCreator = deps?.getCreator ?? defaultGetCreator;
    const getMirror = deps?.getMirror ?? defaultGetMirror;

    const creator = await getCreator();
    await creator.create({
      data: {
        queueKey,
        itemKind,
        itemId,
        transition: input.transition,
        outcome: strOrNull(input.outcome),
        laneKey: strOrNull(input.laneKey),
        actorType: strOrNull(input.actorType),
        actorId: strOrNull(input.actorId),
        ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
      },
    });

    // Prometheus mirror is independently best-effort — a metrics hiccup must not
    // lose the durable event that already landed.
    try {
      const mirror = await getMirror();
      mirrorQueueTransition({ ...input, queueKey, itemKind, itemId }, mirror);
    } catch (mirrorErr) {
      console.warn(
        `[queue-telemetry] metrics mirror failed: ${
          getErrorMessage(mirrorErr)
        }`,
      );
    }
  } catch (err) {
    console.warn(
      `[queue-telemetry] failed to record transition: ${
        getErrorMessage(err)
      }`,
    );
  }
}
