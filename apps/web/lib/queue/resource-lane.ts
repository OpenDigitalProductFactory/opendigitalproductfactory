// apps/web/lib/queue/resource-lane.ts
//
// EP-3516E23D Phase 2 — the reusable compute-admission primitive. A ResourceLane
// serializes access to a scarce in-process compute resource (the local GPU is
// the motivating one) to a concurrency of ONE, with two things the bare
// promise-chain serializer it replaces never had:
//   1. an OPTIONAL bounded queue depth — over the cap, `run` rejects immediately
//      with a typed LaneBusyError (the "honest busy" signal BI-6112DDE0 asks for)
//      instead of letting callers pile up unboundedly and time out while waiting;
//   2. flow telemetry — enqueued/started/finished transitions into the shared
//      spine, so lane wait time and throughput are finally measurable.
//
// DEFAULT BEHAVIOR IS UNCHANGED: with no maxQueueDepth configured the lane is an
// unbounded FIFO serializer — byte-for-byte the semantics of the promise chain it
// replaces (each call gets the full resource; one failure never wedges the rest).
// Bounded admission is strictly opt-in, mirroring the config-gated build-pipeline
// lane in admission.ts. Spec §4.3.

import type { QueueTransitionInput } from "./queue-telemetry";

/** Thrown by `run` when the lane's bounded queue is full. */
export class LaneBusyError extends Error {
  readonly code = "lane_busy";
  constructor(
    readonly laneKey: string,
    readonly depth: number,
  ) {
    super(`Resource lane ${laneKey} is at capacity (${depth} waiting).`);
    this.name = "LaneBusyError";
  }
}

export interface ResourceLaneRunOptions {
  /**
   * Max number of calls allowed to be WAITING (queued but not yet started). When
   * the waiting count is at or above this, `run` throws LaneBusyError instead of
   * enqueuing. null/undefined ⇒ unbounded (default, zero behavior change).
   */
  maxQueueDepth?: number | null;
  /** Correlation id for the telemetry rows; defaults to a per-lane sequence. */
  itemId?: string;
}

export interface ResourceLaneDeps {
  /** Injectable telemetry sink (defaults to recordQueueTransition). */
  record?: (input: QueueTransitionInput) => void;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

/**
 * A single-slot, FIFO admission lane for a scarce in-process resource.
 * Instances are keyed by `laneKey` via `getResourceLane` so every caller sharing
 * a resource shares one lane (and one aggregate queue depth).
 */
export class ResourceLane {
  private chain: Promise<unknown> = Promise.resolve();
  private waiting = 0;
  private seq = 0;
  private readonly record: (input: QueueTransitionInput) => void;
  private readonly now: () => number;

  constructor(
    readonly laneKey: string,
    deps: ResourceLaneDeps = {},
  ) {
    this.record = deps.record ?? defaultRecord;
    this.now = deps.now ?? (() => Date.now());
  }

  /** Current number of calls waiting (queued, not yet started). */
  depth(): number {
    return this.waiting;
  }

  /**
   * Run `fn` with exclusive access to the lane. Serialized to concurrency 1.
   * Rejects with LaneBusyError if a bounded depth is configured and exceeded;
   * otherwise queues (unbounded) exactly like the promise chain it replaces.
   */
  async run<T>(fn: () => Promise<T>, opts: ResourceLaneRunOptions = {}): Promise<T> {
    const maxQueueDepth = opts.maxQueueDepth ?? null;
    if (maxQueueDepth != null && this.waiting >= maxQueueDepth) {
      throw new LaneBusyError(this.laneKey, this.waiting);
    }

    const itemId = opts.itemId ?? `${this.laneKey}#${++this.seq}`;
    const enqueuedAt = this.now();
    this.waiting += 1;
    this.emit({ itemId, transition: "enqueued", occurredAt: new Date(enqueuedAt), depth: this.waiting });

    // Run the body whether the previous link resolved OR rejected (mirrors the
    // original `chain.then(fn, fn)`), so one failure never wedges the lane.
    const body = async (): Promise<T> => {
      this.waiting -= 1;
      const startedAt = this.now();
      this.emit({
        itemId,
        transition: "started",
        occurredAt: new Date(startedAt),
        durations: { waitMs: startedAt - enqueuedAt },
        depth: this.waiting,
      });
      try {
        const value = await fn();
        this.emit({
          itemId,
          transition: "finished",
          outcome: "success",
          durations: { processMs: this.now() - startedAt, waitMs: startedAt - enqueuedAt },
        });
        return value;
      } catch (err) {
        this.emit({
          itemId,
          transition: "finished",
          outcome: "failed",
          durations: { processMs: this.now() - startedAt },
        });
        throw err;
      }
    };

    const run = this.chain.then(body, body);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private emit(
    partial: Omit<QueueTransitionInput, "queueKey" | "itemKind"> & { itemId: string },
  ): void {
    try {
      this.record({
        queueKey: this.laneKey,
        itemKind: "compute",
        actorType: "system",
        ...partial,
      });
    } catch {
      // Telemetry is best-effort; never let it disturb the lane.
    }
  }
}

function defaultRecord(input: QueueTransitionInput): void {
  // Lazy import so this module (and its tests) does not pull the telemetry
  // module — and through it prom-client / the db client — unless actually used.
  void import("./queue-telemetry").then(({ recordQueueTransition }) => {
    void recordQueueTransition(input);
  });
}

const LANES = new Map<string, ResourceLane>();

/** Get (or create) the shared lane for a resource key. One lane per key. */
export function getResourceLane(laneKey: string, deps?: ResourceLaneDeps): ResourceLane {
  let lane = LANES.get(laneKey);
  if (!lane) {
    lane = new ResourceLane(laneKey, deps);
    LANES.set(laneKey, lane);
  }
  return lane;
}

/** Canonical lane key for the single local-GPU inference resource. */
export const LOCAL_INFERENCE_LANE_KEY = "compute:local-inference";

/** Bounded-depth config for the local-inference lane (opt-in; unset ⇒ unbounded). */
export function localInferenceMaxQueueDepth(): number | null {
  const raw = process.env.DPF_LOCAL_INFERENCE_MAX_QUEUE_DEPTH;
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}
