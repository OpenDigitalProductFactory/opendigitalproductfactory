// Inference admission control — bound concurrent inference per engine so a
// growing fleet of autonomous coworkers cannot overload a scarce backend.
//
// The concern (raised operating the autonomous-self-task substrate, BI-3F09BDD4):
// as more coworkers self-drive, every scheduled + build + interactive turn
// eventually funnels through the SAME inference engine. A local model (Docker
// Model Runner, 7-13B class) reliably handles ~1-2 concurrent requests before
// latency collapses; an external provider is bounded by its rate limit and by
// cost. Nothing today bounds the AGGREGATE — the scheduled dispatcher serializes
// its own tasks, but it does not coordinate with interactive chat, build phases,
// or the other autonomous system tasks, all of which hit the engine in the same
// portal process.
//
// This module is the "serialize scarce compute" primitive (EP-056D2A5E) applied
// at the single global inference choke point (`callProvider`). Two mechanisms:
//
//   1. An AsyncLocalStorage origin tag ("interactive" | "autonomous") set once at
//      the autonomous entry point. Everything unlabelled defaults to
//      "interactive" — the safe default, since the only turn we must demote is
//      background work.
//   2. A per-engine priority semaphore. When an engine is at capacity, callers
//      queue; interactive waiters are always served ahead of autonomous ones, so
//      a human waiting on a reply never sits behind a background campaign brief.
//
// Single-process scope: interactive chat (Next request path) and Inngest-
// dispatched autonomous work both execute in the portal's Node process, so an
// in-process semaphore is a correct bound for a single-portal install. A
// distributed lane (for multi-replica portals) is a documented follow-up.

import { AsyncLocalStorage } from "node:async_hooks";

export type InferenceOrigin = "interactive" | "autonomous";

/** Coarse engine bucket. Local models are the scarce, easily-overloaded backend
 *  and get their own tight budget; every remote provider shares an aggregate
 *  outbound budget (a conservative cap on concurrent cost/rate-limit exposure). */
export type EngineKey = "local" | "remote";

const originStore = new AsyncLocalStorage<InferenceOrigin>();

/** Run `fn` with the given inference origin bound for its whole async subtree.
 *  Every `callProvider` beneath it reads this origin without any signature
 *  threading. */
export function withInferenceOrigin<T>(origin: InferenceOrigin, fn: () => T): T {
  return originStore.run(origin, fn);
}

/** The origin of the currently-executing inference call. Defaults to
 *  "interactive" when unset — background callers must opt in via
 *  withInferenceOrigin("autonomous", …). */
export function currentInferenceOrigin(): InferenceOrigin {
  return originStore.getStore() ?? "interactive";
}

export function engineKeyForProvider(providerId: string): EngineKey {
  return providerId === "local" ? "local" : "remote";
}

/** Per-engine concurrency ceiling, read live from env so an operator can size it
 *  to their install without a rebuild. A value ≤ 0 disables gating for that
 *  engine (unlimited) — an explicit escape hatch. Defaults: local = 1 (a single
 *  local model tolerates one in-flight request), remote = 8 (headroom below a
 *  typical provider rate limit). */
export function resolveEngineLimit(engineKey: EngineKey): number {
  const raw =
    engineKey === "local"
      ? process.env.DPF_INFERENCE_MAX_CONCURRENCY_LOCAL
      : process.env.DPF_INFERENCE_MAX_CONCURRENCY_REMOTE;
  const parsed = raw != null && raw.trim() !== "" ? Number(raw) : NaN;
  if (Number.isFinite(parsed)) return Math.trunc(parsed);
  return engineKey === "local" ? 1 : 8;
}

/** Max time a caller will wait for a slot before giving up. A safety net against
 *  a leaked release, not a routine path — with interactive priority and the
 *  serial autonomous dispatcher, sustained saturation is not expected on a
 *  single-operator install. */
function resolveAcquireTimeoutMs(): number {
  const raw = process.env.DPF_INFERENCE_ADMISSION_TIMEOUT_MS;
  const parsed = raw != null && raw.trim() !== "" ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return Math.trunc(parsed);
  return 120_000;
}

interface Waiter {
  origin: InferenceOrigin;
  resolve: () => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
  enqueuedAt: number;
}

interface EngineState {
  active: number;
  interactiveQ: Waiter[];
  autonomousQ: Waiter[];
}

const engines = new Map<EngineKey, EngineState>();

function engineState(key: EngineKey): EngineState {
  let s = engines.get(key);
  if (!s) {
    s = { active: 0, interactiveQ: [], autonomousQ: [] };
    engines.set(key, s);
  }
  return s;
}

/** Pull the next waiter to serve: interactive queue drains before autonomous. */
function nextWaiter(s: EngineState): Waiter | undefined {
  return s.interactiveQ.shift() ?? s.autonomousQ.shift();
}

function removeWaiter(s: EngineState, w: Waiter): void {
  const q = w.origin === "interactive" ? s.interactiveQ : s.autonomousQ;
  const i = q.indexOf(w);
  if (i >= 0) q.splice(i, 1);
}

/**
 * Acquire a slot on `engineKey`. Resolves immediately when the engine is below
 * its ceiling; otherwise queues (by priority) until a slot frees or the timeout
 * fires. Returns a release function that MUST be called (use try/finally) — it
 * frees the slot and wakes the next waiter.
 */
export async function acquireInferenceSlot(
  engineKey: EngineKey,
  origin: InferenceOrigin,
  opts?: { providerId?: string; modelId?: string },
): Promise<() => void> {
  const limit = resolveEngineLimit(engineKey);
  const s = engineState(engineKey);

  // Gating disabled for this engine, or capacity available: take a slot now.
  if (limit <= 0 || s.active < limit) {
    s.active++;
    return makeRelease(engineKey);
  }

  // At capacity — queue with priority and wait.
  const startedWaiting = Date.now();
  await new Promise<void>((resolve, reject) => {
    const waiter: Waiter = {
      origin,
      resolve,
      reject,
      timer: null,
      enqueuedAt: startedWaiting,
    };
    waiter.timer = setTimeout(() => {
      removeWaiter(s, waiter);
      reject(
        new Error(
          `inference admission timeout on ${engineKey} engine after ` +
            `${resolveAcquireTimeoutMs()}ms (origin=${origin}` +
            `${opts?.providerId ? `, provider=${opts.providerId}` : ""})`,
        ),
      );
    }, resolveAcquireTimeoutMs());
    (origin === "interactive" ? s.interactiveQ : s.autonomousQ).push(waiter);
  });

  const waitedMs = Date.now() - startedWaiting;
  if (waitedMs >= 2_000) {
    console.warn(
      "[inference-admission] queued for slot",
      { engineKey, origin, waitedMs, providerId: opts?.providerId, modelId: opts?.modelId },
    );
  }
  // Slot was handed to us by the releaser (which already incremented active).
  return makeRelease(engineKey);
}

function makeRelease(engineKey: EngineKey): () => void {
  let released = false;
  return () => {
    if (released) return; // idempotent — double-release must not corrupt the count
    released = true;
    const s = engineState(engineKey);
    const next = nextWaiter(s);
    if (next) {
      // Hand our slot directly to the next waiter (active count stays put).
      if (next.timer) clearTimeout(next.timer);
      next.resolve();
    } else {
      s.active = Math.max(0, s.active - 1);
    }
  };
}

/** Point-in-time view of admission state — for tests and observability. */
export function getInferenceAdmissionSnapshot(): Record<
  EngineKey,
  { active: number; limit: number; interactiveWaiting: number; autonomousWaiting: number }
> {
  const view = (key: EngineKey) => {
    const s = engines.get(key);
    return {
      active: s?.active ?? 0,
      limit: resolveEngineLimit(key),
      interactiveWaiting: s?.interactiveQ.length ?? 0,
      autonomousWaiting: s?.autonomousQ.length ?? 0,
    };
  };
  return { local: view("local"), remote: view("remote") };
}

/** Test-only: drop all queued/active state so cases start clean. */
export function __resetInferenceAdmissionForTest(): void {
  for (const s of engines.values()) {
    for (const w of [...s.interactiveQ, ...s.autonomousQ]) {
      if (w.timer) clearTimeout(w.timer);
    }
  }
  engines.clear();
}
