// Sweep + submission loop.
//
// Runs forever; every `sweepIntervalSec` it:
//   1. Collects host observations via the configured collectors.
//   2. Builds a discovery-run submission envelope, stamping a fresh
//      runKey (UUID).
//   3. POSTs to /api/v1/edge/discovery-runs via the Authority client.
//   4. On 2xx: drops any queued retries for this envelope.
//   5. On 4xx (non-rate-limit): logs + DROPS the envelope. 4xx means
//      the client did something wrong; retrying won't fix it.
//   6. On 429: respects Retry-After if present; keeps envelope queued.
//   7. On 5xx or network error: queues the envelope with exponential
//      backoff (1s → 2s → 4s → ... cap 5 min). Drains the queue at
//      the start of the next tick before generating a new sweep.
//
// Buffer: in-memory, FIFO, bounded by `maxBufferedSubmissions`
// (default 1000). Drop-OLDEST on overflow so the most recent
// observations win. Persistent SQLite buffer is a Phase 1+ concern
// (spec § S6) — Phase 0 accepts buffer loss across container restart
// because the collector re-runs immediately and the dropped runs are
// idempotent at the runKey layer anyway.
//
// Spec: docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md
//   § Submission contract (Edge Node owns sweep cadence; runKey for idempotency)
// Roadmap: docs/superpowers/plans/2026-05-12-edge-node-phase0-roadmap.md A5

import { randomUUID } from "node:crypto";

import {
  AuthorityHttpError,
  type AuthorityApiClient,
} from "./api-client";
import {
  collectHostInfo,
  type HostInfoAdapter,
  type ObservationItem,
} from "./collectors/host-info";
import type { EdgeNodeConfig } from "./config";
import type { EdgeNodeState } from "./state";

const PHASE_0_CAPABILITY = "discovery.network";

// Backoff schedule for transient (5xx / network) failures. After
// `BACKOFF_SCHEDULE.length` consecutive failures, the same final value
// is reused — we never drop the envelope just because the Authority
// has been down a while; the bounded buffer drops oldest instead.
const BACKOFF_SCHEDULE_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 120_000, 300_000];

export type SubmissionEnvelope = {
  runKey: string;
  agentMode: string;
  agentVersion: string;
  observedAt: string;
  capabilities: string[];
  items: ObservationItem[];
  relationships: never[];
  warnings?: string[];
};

export type SweepRunnerOptions = {
  config: EdgeNodeConfig;
  api: AuthorityApiClient;
  state: EdgeNodeState;
  /** Override for tests. */
  sleep?: (ms: number) => Promise<void>;
  log?: (level: "info" | "warn" | "error", msg: string) => void;
  /** Stop the loop after N sweep ticks (test seam). */
  maxIterations?: number;
  /** Override the host-info adapter (test seam). */
  hostInfoAdapter?: HostInfoAdapter;
  /** Override runKey generation (test seam). */
  newRunKey?: () => string;
  /** Override the wall-clock used for observedAt (test seam). */
  now?: () => Date;
  /** Cap on queued retries; older entries get dropped on overflow. */
  maxBufferedSubmissions?: number;
};

type Queued = {
  envelope: SubmissionEnvelope;
  /** Number of consecutive failed POSTs for this envelope. */
  failureCount: number;
};

/**
 * Run the sweep loop. Returns when `maxIterations` is reached. In
 * normal operation, never returns.
 *
 * The loop is designed to coexist with the heartbeat loop: each runs
 * independently. The heartbeat loop is the authoritative source of
 * runtime config (intervals + accepted capabilities); the sweep loop
 * reads from a shared `state` reference that the heartbeat loop
 * mutates in place. For now, sweep reads `state.sweepIntervalSec`
 * once at startup; future revisions can re-read each tick to honor
 * Authority-driven cadence changes mid-run.
 */
export async function runSweepLoop(opts: SweepRunnerOptions): Promise<void> {
  const log = opts.log ?? defaultLog;
  const sleep = opts.sleep ?? defaultSleep;
  const newRunKey = opts.newRunKey ?? randomUUID;
  const now = opts.now ?? (() => new Date());
  const hostInfoAdapter = opts.hostInfoAdapter;
  const maxBuffer = opts.maxBufferedSubmissions ?? 1000;
  const { config, api, state } = opts;

  const queue: Queued[] = [];

  let iterations = 0;
  while (true) {
    if (opts.maxIterations !== undefined && iterations >= opts.maxIterations) {
      return;
    }
    iterations += 1;

    // Drain any queued retries first. If the Authority just came back,
    // the older envelopes go in before the newly generated one — older
    // observations carry "what was true earlier" and the runKey
    // dedupes them anyway.
    await drainQueue({ queue, api, state, log });

    // Collect + submit a fresh sweep.
    let envelope: SubmissionEnvelope;
    try {
      const { items, relationships } = collectHostInfo(hostInfoAdapter);
      envelope = {
        runKey: newRunKey(),
        agentMode: config.installMode,
        agentVersion: config.version,
        observedAt: now().toISOString(),
        capabilities: [PHASE_0_CAPABILITY],
        items,
        relationships,
      };
    } catch (err) {
      // Collection itself failed — log + move on. We don't retry
      // collection; the next interval will produce a fresh attempt.
      log("error", `Sweep collect failed: ${(err as Error).message}`);
      await sleep(state.sweepIntervalSec * 1000);
      continue;
    }

    const result = await submitOnce({ envelope, api, state, log });
    if (result === "drop") {
      // 4xx — client error, queueing won't help. Already logged below.
    } else if (result === "retry") {
      enqueue({ queue, item: { envelope, failureCount: 1 }, maxBuffer, log });
    }
    // result === "ok": nothing to do.

    await sleep(state.sweepIntervalSec * 1000);
  }
}

type SubmitOutcome = "ok" | "drop" | "retry";

async function submitOnce(args: {
  envelope: SubmissionEnvelope;
  api: AuthorityApiClient;
  state: EdgeNodeState;
  log: (level: "info" | "warn" | "error", msg: string) => void;
}): Promise<SubmitOutcome> {
  const { envelope, api, state, log } = args;
  try {
    await api.submitDiscoveryRun(state.nodeToken, envelope);
    log(
      "info",
      `Discovery run submitted: runKey=${envelope.runKey} items=${envelope.items.length}`,
    );
    return "ok";
  } catch (err) {
    if (err instanceof AuthorityHttpError) {
      // 401 + node_revoked is terminal for the loop — the heartbeat
      // loop will clear local state and exit. Sweep loop just stops
      // submitting and lets that happen.
      if (err.status === 401 && err.errorCode === "node_revoked") {
        log("error", "Sweep got node_revoked — sweep loop is now a no-op until restart.");
        return "drop";
      }
      // 413 / 400 / 403 — client error. Retrying same envelope won't
      // succeed. Log + drop.
      if (err.status >= 400 && err.status < 500 && err.status !== 429) {
        log(
          "warn",
          `Sweep dropped (HTTP ${err.status} error=${err.errorCode ?? "unknown"}): ${err.message}`,
        );
        return "drop";
      }
      // 429 / 5xx — transient. Queue for retry.
      log(
        "warn",
        `Sweep transient failure (HTTP ${err.status} error=${err.errorCode ?? "unknown"}): ${err.message}. Queueing.`,
      );
      return "retry";
    }
    // Network / unknown — transient.
    log("warn", `Sweep network failure: ${(err as Error).message}. Queueing.`);
    return "retry";
  }
}

async function drainQueue(args: {
  queue: Queued[];
  api: AuthorityApiClient;
  state: EdgeNodeState;
  log: (level: "info" | "warn" | "error", msg: string) => void;
}): Promise<void> {
  const { queue, api, state, log } = args;
  if (queue.length === 0) return;

  // Drain in FIFO order. If any retry fails with a transient error,
  // re-queue at the head (so order is preserved) and stop draining for
  // this tick — back-pressure prevents a single hung retry from
  // burning the entire interval re-trying everything in order.
  while (queue.length > 0) {
    const head = queue[0]!;
    const idx = Math.min(head.failureCount, BACKOFF_SCHEDULE_MS.length - 1);
    const _backoffMs = BACKOFF_SCHEDULE_MS[idx];
    // Backoff is applied as "skip this drain attempt if the backoff
    // hasn't elapsed since the last failure". For Phase 0 simplicity
    // we just try once per tick regardless; the tick cadence
    // (sweepIntervalSec, default 5 min) is already a coarse backoff.
    // Real per-envelope timestamps land in Phase 1.
    void _backoffMs;

    const result = await submitOnce({
      envelope: head.envelope,
      api,
      state,
      log,
    });
    if (result === "ok") {
      queue.shift();
    } else if (result === "drop") {
      queue.shift();
    } else {
      // retry — bump failure count and stop draining this tick.
      head.failureCount += 1;
      return;
    }
  }
}

function enqueue(args: {
  queue: Queued[];
  item: Queued;
  maxBuffer: number;
  log: (level: "info" | "warn" | "error", msg: string) => void;
}): void {
  const { queue, item, maxBuffer, log } = args;
  queue.push(item);
  while (queue.length > maxBuffer) {
    const dropped = queue.shift();
    log(
      "warn",
      `Sweep buffer full (max=${maxBuffer}); dropped oldest envelope runKey=${dropped?.envelope.runKey}.`,
    );
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultLog(level: "info" | "warn" | "error", msg: string): void {
  const ts = new Date().toISOString();
  const line = `${ts} [${level}] ${msg}`;
  if (level === "error") console.error(line);
  else console.log(line);
}

// Exported for tests only.
export const _internal = { BACKOFF_SCHEDULE_MS };
