// apps/web/lib/routing/cli-concurrency.ts
//
// Global bounded-concurrency gate for CLI-backed inference (codex-cli +
// claude-cli). Both adapters spawn a `docker exec <sandbox> <runner>` child
// held open up to CLI_TIMEOUT_MS (10 min) through the SAME shared sandbox
// container. Nothing bounded how many ran at once, so a fan-out — Build Studio
// (e.g. reviewDesignDoc = 3 parallel reviewers) OR many concurrent AI coworkers
// — could pile dozens of held-open `docker exec` children onto the one sandbox
// and the Docker daemon, starving the portal event loop (the observed
// "portal :3000 not responding" incidents).
//
// The scarce resource is the shared sandbox, not any one caller, so the gate
// lives here at the adapter seam and is GLOBAL: every CLI inference call from
// every caller (Build Studio, coworkers, evals) acquires a slot first. This is
// the CLI analog of chat-adapter.ts's `withLocalInferenceLock` (which serializes
// the single-GPU local endpoint) — a bounded semaphore rather than a strict
// serial chain, because the sandbox can handle a handful of concurrent CLIs.
//
// Default cap is deliberately small (4). Env-overridable via
// DPF_CLI_MAX_CONCURRENCY for operators on bigger/smaller hardware. Excess
// calls queue and run as slots free; none are dropped.

/** Resolve the concurrency cap each acquire so an operator env change (or a
 *  test override) takes effect without a process restart. Floors at 1. */
function maxConcurrency(): number {
  const raw = Number(process.env.DPF_CLI_MAX_CONCURRENCY);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 4;
}

let inFlight = 0;
const waiters: Array<() => void> = [];

/**
 * Acquire a slot. Resolves immediately when under the cap; otherwise queues
 * (FIFO) until a slot is released. The slot is accounted the moment this
 * resolves, so `release()` must be called exactly once per acquire.
 */
function acquire(): Promise<void> {
  if (inFlight < maxConcurrency()) {
    inFlight++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    waiters.push(() => {
      // Slot handed over directly by release(); inFlight already reflects the
      // hold (release did NOT decrement when handing off), so just proceed.
      resolve();
    });
  });
}

/**
 * Release a slot. If anyone is queued, hand the slot directly to the next
 * waiter (inFlight stays the same — no window where a freed slot could be
 * grabbed by a later caller ahead of the queue). Otherwise decrement.
 */
function release(): void {
  const next = waiters.shift();
  if (next) {
    next();
  } else {
    inFlight = Math.max(0, inFlight - 1);
  }
}

/**
 * Run `fn` while holding one CLI concurrency slot. The slot is released when
 * `fn`'s promise settles (resolve OR reject — including timeouts), so one hung
 * or failing CLI never permanently consumes a slot. Callers wrap ONLY the
 * heavy spawn-and-wait section, not cheap prep, to keep slots turning over.
 */
export async function withCliSlot<T>(fn: () => Promise<T>): Promise<T> {
  const queuedAtEntry = waiters.length;
  const hadToWait = inFlight >= maxConcurrency();
  await acquire();
  if (hadToWait) {
    // Surfaced so operators can see sandbox contention in the portal logs —
    // sustained queueing means the cap (or the sandbox) is the bottleneck.
    console.log(
      `[cli-concurrency] queued for a CLI slot (inFlight=${inFlight}/${maxConcurrency()}, queuedAhead=${queuedAtEntry})`,
    );
  }
  try {
    return await fn();
  } finally {
    release();
  }
}

/**
 * Current gate state — for tests and operator observability. Not part of the
 * hot path.
 */
export function cliConcurrencyStats(): {
  inFlight: number;
  queued: number;
  max: number;
} {
  return { inFlight, queued: waiters.length, max: maxConcurrency() };
}

/** Test-only: reset gate state between cases. */
export function __resetCliConcurrencyForTest(): void {
  inFlight = 0;
  waiters.length = 0;
}
