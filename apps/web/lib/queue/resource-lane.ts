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
  /** Parent cancellation removes waiting work; active work retains its slot until settled. */
  signal?: AbortSignal;
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
    opts.signal?.throwIfAborted();
    const maxQueueDepth = opts.maxQueueDepth ?? null;
    if (maxQueueDepth != null && this.waiting >= maxQueueDepth) {
      throw new LaneBusyError(this.laneKey, this.waiting);
    }

    const itemId = opts.itemId ?? `${this.laneKey}#${++this.seq}`;
    const enqueuedAt = this.now();
    this.waiting += 1;
    this.emit({ itemId, transition: "enqueued", occurredAt: new Date(enqueuedAt), depth: this.waiting });
    let queued = true;
    let rejectCanceled: (reason: unknown) => void = () => undefined;
    const canceled = new Promise<never>((_resolve, reject) => { rejectCanceled = reject; });
    const cancel = () => {
      if (!queued) return;
      queued = false;
      this.waiting -= 1;
      this.emit({ itemId, transition: "finished", outcome: "failed", depth: this.waiting,
        durations: { waitMs: this.now() - enqueuedAt } });
      rejectCanceled(opts.signal?.reason ?? new Error("inference-parent-canceled"));
    };
    opts.signal?.addEventListener("abort", cancel, { once: true });

    // Run the body whether the previous link resolved OR rejected (mirrors the
    // original `chain.then(fn, fn)`), so one failure never wedges the lane.
    const body = async (): Promise<T> => {
      // A canceled chain link is a tombstone, not another provider dispatch.
      if (!queued) throw opts.signal?.reason ?? new Error("inference-parent-canceled");
      queued = false;
      opts.signal?.removeEventListener("abort", cancel);
      this.waiting -= 1;
      opts.signal?.throwIfAborted();
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
    return Promise.race([run, canceled]).finally(() => opts.signal?.removeEventListener("abort", cancel));
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

// The single local GPU (Docker Model Runner / Ollama) serves ONE request at a
// time. BI-98572A51: chat inference and the local (opencode) build engine each
// hit that one GPU, and both admission points run in the PORTAL process (chat
// makes the HTTP call; the build orchestrator spawns AND awaits the sandbox CLI
// for its whole run). They must share ONE admission gate or they collide/OOM —
// so the canonical `withLocalInferenceLock` lives HERE, beside the lane key, and
// BOTH callers import it. Defining it here (not in chat-adapter) makes the lane
// singleton's telemetry deps independent of which caller loads first.
const localInferenceLane = getResourceLane(LOCAL_INFERENCE_LANE_KEY, {
  record: (input: QueueTransitionInput) => {
    // Only emit on the hot inference path when an operator has opted into
    // managing the lane — avoids per-inference DB writes in the default config.
    if (localInferenceMaxQueueDepth() == null) return;
    void import("./queue-telemetry").then(({ recordQueueTransition }) => {
      void recordQueueTransition(input);
    });
  },
});

/** Run `fn` under the single-slot local-GPU admission lane. The one gate every
 *  local-inference caller (chat + build) must acquire so the single GPU is
 *  never double-subscribed (BI-98572A51).
 *
 *  The lane only sees this process. After waiting, check the host lease and
 *  whether the card is free (another process, another app, a game). Unit tests skip that
 *  import: it reaches the lease registry, and the suite must not touch the GPU. */
export function withLocalInferenceLock<T>(
  fn: () => Promise<T>,
  options?: { modelId?: string | null; signal?: AbortSignal },
): Promise<T> {
  const vitest = process.env.VITEST === "true" || process.env.VITEST === "1";
  if (vitest) {
    return localInferenceLane.run(fn, { maxQueueDepth: localInferenceMaxQueueDepth(), signal: options?.signal });
  }
  return admitLocalGpuThenRun(fn, options?.modelId ?? null, options?.signal);
}

async function admitLocalGpuThenRun<T>(fn: () => Promise<T>, modelId: string | null, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  const { assertLocalGpuFree } = await import("@/lib/inference/host-gpu-admission");
  return localInferenceLane.run(async () => {
    const { assertLocalProviderCapacityAvailable } = await import("@/lib/routing/local-provider-capacity");
    await assertLocalProviderCapacityAvailable();
    await assertLocalGpuFree({ modelId });
    return fn();
  }, { maxQueueDepth: localInferenceMaxQueueDepth(), signal });
}
