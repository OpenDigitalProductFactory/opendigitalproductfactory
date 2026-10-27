import { AsyncLocalStorage } from "node:async_hooks";
import { createOffThreadpoolFetchTransport, type OffThreadpoolFetchTransport } from "@/lib/network/off-threadpool-fetch";

export type InferenceOrigin = "interactive" | "autonomous";
const originStore = new AsyncLocalStorage<{ origin?: InferenceOrigin; signal?: AbortSignal;
  authorityChecks?: readonly (() => Promise<boolean>)[] }>();

/** Shared caller context lives below admission and provider adapters. */
export function withInferenceOrigin<T>(origin: InferenceOrigin, fn: () => T): T {
  return originStore.run({ ...originStore.getStore(), origin }, fn);
}

export function currentInferenceOrigin(): InferenceOrigin {
  return originStore.getStore()?.origin ?? "interactive";
}

/** Caller cancellation never grants or replaces governed parent authority. */
export function withInferenceCancellation<T>(signal: AbortSignal, fn: () => T): T {
  const inherited = currentInferenceSignal();
  return originStore.run({ ...originStore.getStore(),
    signal: inherited && inherited !== signal ? AbortSignal.any([inherited, signal]) : signal,
  }, fn);
}

export function currentInferenceSignal(parentSignal?: AbortSignal): AbortSignal | undefined {
  const callerSignal = originStore.getStore()?.signal;
  return callerSignal && parentSignal && callerSignal !== parentSignal
    ? AbortSignal.any([callerSignal, parentSignal]) : callerSignal ?? parentSignal;
}

/** Narrow an accepted caller's authority at the existing dispatch choke point.
 * This supplies neither a parent deadline nor permission; inherited checks stay. */
export function withInferenceAuthorityCheck<T>(verify: () => Promise<boolean>, execute: () => T): T {
  const inherited = originStore.getStore();
  return originStore.run({ ...inherited,
    authorityChecks: [...(inherited?.authorityChecks ?? []), verify] }, execute);
}

type DeadlineScope = Readonly<{
  deadlineAt: number;
  signal: AbortSignal;
  assertAuthority(): Promise<void>;
  localFetch: typeof fetch;
}>;
const deadlines = new AsyncLocalStorage<DeadlineScope>();
const REVALIDATE_MS = 10_000;

export class GovernedInferenceDeadlineError extends Error {
  readonly code = "INFERENCE_PARENT_STOPPED";
  constructor(reason: string) {
    super(`inference-parent-${reason}`);
    this.name = "GovernedInferenceDeadlineError";
  }
}

/** Cancellation ends this wait; it never supplies or revokes parent authority. */
export function awaitInferenceCancellation<T>(checking: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const canceled = () => { signal.removeEventListener("abort", canceled); reject(signal.reason); };
    signal.addEventListener("abort", canceled, { once: true });
    checking.then(value => { signal.removeEventListener("abort", canceled); resolve(value); }, error => {
      signal.removeEventListener("abort", canceled); reject(error);
    });
    if (signal.aborted) canceled();
  });
}

/** Only server executors may bind a persisted parent deadline after admission.
 * Origin, model choice and caller duration are deliberately not authority. */
export async function withGovernedInferenceDeadline<T>(
  input: { deadlineAt: string; verifyAuthority: () => Promise<boolean> },
  execute: () => Promise<T>,
): Promise<T> {
  const deadlineAt = Date.parse(input.deadlineAt);
  const remaining = deadlineAt - Date.now();
  if (!Number.isSafeInteger(remaining) || remaining <= 0 || remaining > 2_147_483_647) {
    throw new GovernedInferenceDeadlineError("deadline-exhausted-or-invalid");
  }
  // Never nest a fresh allowance under an existing immutable parent.
  if (deadlines.getStore()) throw new GovernedInferenceDeadlineError("deadline-already-bound");
  const controller = new AbortController();
  let checking: Promise<void> | undefined;
  let disposed = false;
  let transport: OffThreadpoolFetchTransport | undefined;
  const check = async () => {
    controller.signal.throwIfAborted();
    if (Date.now() >= deadlineAt) {
      controller.abort(new GovernedInferenceDeadlineError("deadline-exhausted"));
      controller.signal.throwIfAborted();
    }
    if (!checking) checking = (async () => {
      try {
        if (!await input.verifyAuthority() && !disposed) {
          controller.abort(new GovernedInferenceDeadlineError("authority-lost"));
        }
      } catch {
        if (!disposed) controller.abort(new GovernedInferenceDeadlineError("authority-unavailable"));
      }
    })().finally(() => { checking = undefined; });
    await awaitInferenceCancellation(checking, controller.signal);
    controller.signal.throwIfAborted();
    if (Date.now() >= deadlineAt) {
      controller.abort(new GovernedInferenceDeadlineError("deadline-exhausted"));
      controller.signal.throwIfAborted();
    }
  };
  const timer = setTimeout(() => controller.abort(new GovernedInferenceDeadlineError("deadline-exhausted")), remaining);
  timer.unref?.();
  const watcher = setInterval(() => { void check().catch(() => undefined); }, REVALIDATE_MS);
  watcher.unref?.();
  const localFetch: typeof fetch = async (url, init) => {
    await check();
    // One transport per admitted activity, shared by all its local branches.
    // Its finite parser backstop never replaces the absolute parent signal.
    transport ??= createOffThreadpoolFetchTransport({ headersTimeoutMs: remaining, bodyTimeoutMs: remaining });
    return transport.fetch(url, { ...init, signal: init?.signal
      ? AbortSignal.any([init.signal, controller.signal]) : controller.signal });
  };
  try {
    await check();
    return await deadlines.run(Object.freeze({ deadlineAt, signal: controller.signal, assertAuthority: check, localFetch }), execute);
  } finally {
    disposed = true;
    clearTimeout(timer);
    clearInterval(watcher);
    controller.abort(new GovernedInferenceDeadlineError("scope-closed"));
    await transport?.close();
  }
}

export function currentGovernedInferenceDeadline(): DeadlineScope | undefined {
  return deadlines.getStore();
}

/** Called at the common provider choke point, including every fallback. */
export async function assertGovernedInferenceAuthority(callerSignal?: AbortSignal): Promise<void> {
  const signal = currentInferenceSignal(callerSignal);
  signal?.throwIfAborted();
  const checking = deadlines.getStore()?.assertAuthority();
  if (checking) await (signal ? awaitInferenceCancellation(checking, signal) : checking);
  for (const verify of originStore.getStore()?.authorityChecks ?? []) {
    signal?.throwIfAborted();
    const checked = Promise.resolve().then(verify).catch(error => {
      if (signal?.aborted && error === signal.reason) throw error;
      throw new GovernedInferenceDeadlineError("authority-unavailable");
    });
    const authorized = await (signal ? awaitInferenceCancellation(checked, signal) : checked);
    signal?.throwIfAborted();
    if (!authorized) throw new GovernedInferenceDeadlineError("authority-lost");
  }
}
