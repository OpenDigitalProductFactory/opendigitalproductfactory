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
// DEFAULT BEHAVIOR IS UNCHANGED: with no priority supplied, every entry is
// interactive and the lane remains an unbounded FIFO serializer. Explicit local
// producers may label autonomous work; interactive waiters then go first until
// bounded aging promotes the oldest autonomous waiter. Each call still gets the
// full resource, and one failure never wedges the rest. Spec §4.3.

import { AsyncLocalStorage } from "node:async_hooks";
import type { QueueTransitionInput } from "./queue-telemetry";
import {
  createInferenceAdmissionTimeoutError,
  resolveAcquireTimeoutMs,
  admissionObservation,
  type InferenceAdmissionEvent,
} from "@/lib/inference/inference-admission";

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
  /** Interactive work normally runs before autonomous/background work. */
  priority?: "interactive" | "autonomous";
  /** Promote an autonomous waiter after this many milliseconds. */
  autonomousAgingMs?: number | null;
  /** Reject and remove a waiter that has not started within this budget. */
  waitTimeoutMs?: number | null;
  /** Optional domain-specific timeout error factory. */
  waitTimeoutError?: () => Error;
  /** Parent cancellation removes queued work; active work keeps its slot until settled. */
  signal?: AbortSignal;
  /** Advisory caller-scoped evidence; never changes admission or telemetry policy. */
  observeAdmission?: (phase: InferenceAdmissionEvent["phase"]) => void;
}

export interface ResourceLaneDeps {
  /** Injectable telemetry sink (defaults to recordQueueTransition). */
  record?: (input: QueueTransitionInput) => void;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

/**
 * A single-slot admission lane for a scarce in-process resource.
 * Instances are keyed by `laneKey` via `getResourceLane` so every caller sharing
 * a resource shares one lane (and one aggregate queue depth).
 */
export class ResourceLane {
  private queue: Array<{
    fn: () => Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
    itemId: string;
    enqueuedAt: number;
    priority: "interactive" | "autonomous";
    autonomousAgingMs: number | null;
    waitTimer: ReturnType<typeof setTimeout> | null;
    cleanup: () => void;
    observe: (phase: InferenceAdmissionEvent["phase"]) => void;
  }> = [];
  private active = false;
  private pumpScheduled = false;
  private waiting = 0;
  private seq = 0;
  private lastSelectionWasAgedPromotion = false;
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

    const priority = opts.priority ?? "interactive";
    const itemId = opts.itemId ?? `${this.laneKey}:${priority}#${++this.seq}`;
    const enqueuedAt = this.now();
    const observe = AsyncLocalStorage.bind((phase: InferenceAdmissionEvent["phase"]) => {
      try {
        const pending: unknown = opts.observeAdmission?.(phase);
        if (pending !== undefined) void Promise.resolve(pending).catch(() => undefined);
      }
      catch { /* Advisory observation cannot disturb the lane. */ }
    });
    this.waiting += 1;
    observe("queued");
    this.emit({ itemId, transition: "enqueued", occurredAt: new Date(enqueuedAt), depth: this.waiting });

    const run = new Promise<T>((resolve, reject) => {
      const entry = {
        // The pump runs from the previous holder's completion context. Restore
        // this submitter's authority, deadline and origin when its turn starts.
        fn: AsyncLocalStorage.bind(fn),
        resolve: resolve as (value: unknown) => void,
        reject,
        itemId,
        enqueuedAt,
        priority,
        autonomousAgingMs: normalizeAgingMs(opts.autonomousAgingMs),
        waitTimer: null as ReturnType<typeof setTimeout> | null,
        cleanup: () => opts.signal?.removeEventListener("abort", cancel),
        observe,
      };
      const cancel = () => {
        const index = this.queue.indexOf(entry);
        if (index < 0) return;
        this.queue.splice(index, 1);
        if (entry.waitTimer) clearTimeout(entry.waitTimer);
        entry.cleanup();
        this.waiting -= 1;
        observe("canceled");
        entry.reject(opts.signal?.reason ?? new Error("inference-parent-canceled"));
        this.emit({ itemId, transition: "finished", outcome: "failed", depth: this.waiting,
          durations: { waitMs: this.now() - enqueuedAt } });
        this.schedulePump();
      };
      this.queue.push(entry);
      opts.signal?.addEventListener("abort", cancel, { once: true });
      const waitTimeoutMs = normalizeWaitTimeoutMs(opts.waitTimeoutMs);
      if (waitTimeoutMs != null) {
        entry.waitTimer = setTimeout(() => {
          const index = this.queue.indexOf(entry);
          if (index < 0) return;
          this.queue.splice(index, 1);
          entry.cleanup();
          this.waiting -= 1;
          observe("timed-out");
          const waitedMs = this.now() - enqueuedAt;
          entry.reject(opts.waitTimeoutError?.() ?? new Error(
            `Resource lane ${this.laneKey} wait timed out after ${waitTimeoutMs}ms.`,
          ));
          this.emit({
            itemId,
            transition: "finished",
            outcome: "failed",
            occurredAt: new Date(this.now()),
            durations: { waitMs: waitedMs },
            depth: this.waiting,
          });
          this.schedulePump();
        }, waitTimeoutMs);
      }
      this.schedulePump();
    });
    return run;
  }

  private schedulePump(): void {
    if (this.active || this.pumpScheduled) return;
    this.pumpScheduled = true;
    void Promise.resolve().then(() => {
      this.pumpScheduled = false;
      this.pump();
    });
  }

  private pump(): void {
    if (this.active || this.queue.length === 0) return;
    this.active = true;
    const index = this.selectNextIndex();
    const entry = this.queue.splice(index, 1)[0]!;
    if (entry.waitTimer) clearTimeout(entry.waitTimer);
    entry.cleanup();
    this.waiting -= 1;
    const startedAt = this.now();
    entry.observe("acquired");
    this.emit({
      itemId: entry.itemId,
      transition: "started",
      occurredAt: new Date(startedAt),
      durations: { waitMs: startedAt - entry.enqueuedAt },
      depth: this.waiting,
    });

    let execution: Promise<unknown>;
    try {
      execution = entry.fn();
    } catch (err) {
      execution = Promise.reject(err);
    }
    void execution.then(
      (value) => {
        entry.resolve(value);
        this.emit({
          itemId: entry.itemId,
          transition: "finished",
          outcome: "success",
          durations: { processMs: this.now() - startedAt, waitMs: startedAt - entry.enqueuedAt },
        });
      },
      (err) => {
        entry.reject(err);
        this.emit({
          itemId: entry.itemId,
          transition: "finished",
          outcome: "failed",
          durations: { processMs: this.now() - startedAt },
        });
      },
    ).finally(() => {
      this.active = false;
      entry.observe("released");
      this.pump();
    });
  }

  private selectNextIndex(): number {
    const now = this.now();
    const agedAutonomous = this.queue.findIndex((entry) =>
      entry.priority === "autonomous"
      && entry.autonomousAgingMs != null
      && now - entry.enqueuedAt >= entry.autonomousAgingMs,
    );
    const interactive = this.queue.findIndex((entry) => entry.priority === "interactive");
    // Aging gives background work a turn, not the entire remaining queue.
    // Otherwise a batch that aged behind one long holder can exhaust every
    // interactive wait budget while it drains. Alternate only while both
    // classes contend; preserve FIFO and the existing first aged promotion.
    if (agedAutonomous >= 0 && interactive >= 0 && !this.lastSelectionWasAgedPromotion) {
      this.lastSelectionWasAgedPromotion = true;
      return agedAutonomous;
    }
    this.lastSelectionWasAgedPromotion = false;
    return interactive >= 0 ? interactive : 0;
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

// Next can evaluate this module independently for instrumentation, handlers
// and SSR. A module-local Map gives each bundle its own "single" GPU lane.
// Share the registry across those module caches in the same Node process.
const LANES_REGISTRY_KEY = Symbol.for("dpf.resource-lanes.v1");
const laneGlobal = globalThis as typeof globalThis & {
  [LANES_REGISTRY_KEY]?: Map<string, ResourceLane>;
};
const LANES = laneGlobal[LANES_REGISTRY_KEY] ??= new Map<string, ResourceLane>();

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
  return parsePositiveInteger(process.env.DPF_LOCAL_INFERENCE_MAX_QUEUE_DEPTH);
}

/** Maximum time an autonomous local request may be overtaken by interactive work. */
export function localInferenceAutonomousAgingMs(): number {
  return parsePositiveInteger(process.env.DPF_LOCAL_INFERENCE_AUTONOMOUS_AGING_MS) ?? 120_000;
}

function parsePositiveInteger(raw: string | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function normalizeAgingMs(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function normalizeWaitTimeoutMs(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
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
 *  The lane only sees this process. After taking it, ask whether the card is
 *  free at all (another process, another app, a game). This ordering lets DPF's
 *  own callers queue instead of misclassifying each other as external owners. */
export function withLocalInferenceLock<T>(
  fn: () => Promise<T>,
  options?: { modelId?: string | null; origin?: "interactive" | "autonomous"; signal?: AbortSignal },
): Promise<T> {
  const origin = options?.origin ?? "interactive";
  const waitTimeoutMs = resolveAcquireTimeoutMs(origin);
  return localInferenceLane.run(
    () => probeLocalGpuThenRun(fn, options?.modelId ?? null, options?.signal),
    {
      maxQueueDepth: localInferenceMaxQueueDepth(),
      priority: origin,
      observeAdmission: admissionObservation("local", origin),
      signal: options?.signal,
      autonomousAgingMs: localInferenceAutonomousAgingMs(),
      waitTimeoutMs,
      waitTimeoutError: () => createInferenceAdmissionTimeoutError("local", origin, waitTimeoutMs, {
        providerId: "local",
      }),
    },
  );
}

async function probeLocalGpuThenRun<T>(fn: () => Promise<T>, modelId: string | null, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  const { assertGovernedInferenceAuthority } = await import("@/lib/routing/governed-inference-deadline");
  await assertGovernedInferenceAuthority(signal);
  const { assertLocalGpuFree } = await import("@/lib/inference/host-gpu-admission");
  const { assertLocalProviderCapacityAvailable } = await import("@/lib/routing/local-provider-capacity");
  await assertLocalProviderCapacityAvailable();
  await assertLocalGpuFree({ modelId });
  signal?.throwIfAborted();
  await assertGovernedInferenceAuthority(signal);
  return fn();
}
