/**
 * Run execution for the owned durable-job engine (spec 2026-09-25 §5.3).
 *
 * Every attempt replays the handler from the top. `step.run` returns a stored
 * output without calling its function when the step already completed, so a
 * replay re-executes nothing that finished. `sleep` and `waitForEvent` park the
 * run and end the attempt; a later claim replays it past the parked step.
 *
 * Parking does not throw into the handler. The step returns a promise that
 * never settles and the attempt resolves from the outside, as Inngest does,
 * so a handler's own try/catch can never swallow a park.
 */
import type { Pool } from "pg";

import {
  JOB_FAILURE_EVENT_NAME,
  type JobDuration,
  type JobFailureEvent,
  type JobReceivedEvent,
  type JobStepTools,
  type JobWaitForEventOptions,
} from "../types";
import { durationMs, retryBackoffMs } from "./durations";
import type { RegisteredFunction } from "./registry";
import * as store from "./store";
import type { JobRunRow } from "./store";

export type RunOutcome =
  | { kind: "completed" }
  | { kind: "sleeping"; until: Date }
  | { kind: "waiting" }
  | { kind: "retrying"; runAfter: Date }
  | { kind: "failed"; error: string }
  | { kind: "cancelled" }
  | { kind: "lost" };

type Park =
  | { kind: "sleep"; stepKey: string; wakeAt: Date }
  | { kind: "wait"; stepKey: string; eventName: string; matchExpr: string | null; expiresAt: Date }
  | { kind: "cancelled" };

export type ExecuteOptions = { owner: string; leaseMs: number; now?: () => Date };

/** Stored output as the handler sees it: JSON-shaped, `undefined` as null (Jsonify). */
function toStored(value: unknown): unknown {
  return value === undefined ? null : JSON.parse(JSON.stringify(value));
}

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** Step ids repeated within one run get Inngest's `:n` suffix, so replay order matches. */
function stepKeyFactory() {
  const seen = new Map<string, number>();
  return (id: string) => {
    const count = seen.get(id) ?? 0;
    seen.set(id, count + 1);
    return count === 0 ? id : `${id}:${count}`;
  };
}

function createStepTools(args: {
  pool: Pool;
  run: JobRunRow;
  steps: Map<string, unknown>;
  prefix: string;
  options: ExecuteOptions;
  park: (park: Park) => void;
}): JobStepTools {
  const { pool, run, steps, options } = args;
  const key = stepKeyFactory();
  const now = options.now ?? (() => new Date());
  const halt = <T>(park: Park): Promise<T> => {
    args.park(park);
    return new Promise<T>(() => {});
  };

  return {
    async run(id, fn) {
      const stepKey = args.prefix + key(id);
      if (steps.has(stepKey)) return steps.get(stepKey) as never;
      // A step boundary is where a cancel (or a recovered lease) takes effect.
      if (!(await store.renewLease(pool, run.id, options.owner, options.leaseMs))) return halt({ kind: "cancelled" });
      const output = toStored(await fn());
      const stored = await store.saveStep(pool, run.id, stepKey, output);
      steps.set(stepKey, stored);
      return stored as never;
    },
    async sleep(id: string, duration: JobDuration) {
      const stepKey = args.prefix + key(id);
      if (steps.has(stepKey)) return;
      return halt({ kind: "sleep", stepKey, wakeAt: new Date(now().getTime() + durationMs(duration)) });
    },
    async sleepUntil(id: string, time: Date | string) {
      const stepKey = args.prefix + key(id);
      if (steps.has(stepKey)) return;
      const wakeAt = new Date(time);
      if (Number.isNaN(wakeAt.getTime())) throw new Error(`step.sleepUntil(${JSON.stringify(id)}) received an invalid time.`);
      return halt({ kind: "sleep", stepKey, wakeAt });
    },
    async waitForEvent<const TName extends string>(id: string, wait: JobWaitForEventOptions<TName>) {
      const stepKey = args.prefix + key(id);
      if (steps.has(stepKey)) return steps.get(stepKey) as JobReceivedEvent<TName> | null;
      return halt({
        kind: "wait",
        stepKey,
        eventName: wait.event,
        matchExpr: wait.if ?? null,
        expiresAt: new Date(now().getTime() + durationMs(wait.timeout)),
      });
    },
  };
}

/**
 * Invoke `handler` with step tools until it returns, throws, or parks.
 * Returns which of the three happened.
 */
async function invoke(
  handler: (tools: JobStepTools) => unknown,
  tools: (park: (p: Park) => void) => JobStepTools,
): Promise<{ kind: "returned"; value: unknown } | { kind: "threw"; error: unknown } | { kind: "parked"; park: Park }> {
  let onPark: (park: Park) => void = () => {};
  const parked = new Promise<Park>((resolve) => {
    onPark = resolve;
  });
  const settled = Promise.resolve()
    .then(() => handler(tools((park) => onPark(park))))
    .then((value) => ({ kind: "returned" as const, value }), (error: unknown) => ({ kind: "threw" as const, error }));
  return Promise.race([settled, parked.then((park) => ({ kind: "parked" as const, park }))]);
}

/** Execute one claimed run to its next durable state. */
export async function executeRun(pool: Pool, fn: RegisteredFunction, run: JobRunRow, options: ExecuteOptions): Promise<RunOutcome> {
  const steps = await store.loadSteps(pool, run.id);
  const result = await invoke(
    (step) => fn.handler({ event: run.event, step }),
    (park) => createStepTools({ pool, run, steps, prefix: "", options, park }),
  );

  if (result.kind === "parked") return settlePark(pool, run, options, result.park);
  if (result.kind === "returned") {
    return (await store.completeRun(pool, run.id, options.owner, toStored(result.value))) ? { kind: "completed" } : { kind: "lost" };
  }

  const error = errorText(result.error);
  const attemptsUsed = run.attempt + 1;
  if (attemptsUsed < run.maxAttempts) {
    const runAfter = new Date((options.now?.() ?? new Date()).getTime() + retryBackoffMs(attemptsUsed));
    return (await store.retryRun(pool, run.id, options.owner, error, runAfter)) ? { kind: "retrying", runAfter } : { kind: "lost" };
  }
  if (fn.options.onFailure) await runOnFailure(pool, fn, run, options, result.error, steps);
  return (await store.failRun(pool, run.id, options.owner, error)) ? { kind: "failed", error } : { kind: "lost" };
}

async function settlePark(pool: Pool, run: JobRunRow, options: ExecuteOptions, park: Park): Promise<RunOutcome> {
  if (park.kind === "cancelled") return { kind: "cancelled" };
  if (park.kind === "sleep") {
    return (await store.parkSleep(pool, run.id, options.owner, park.stepKey, park.wakeAt))
      ? { kind: "sleeping", until: park.wakeAt }
      : { kind: "lost" };
  }
  return (await store.parkWait(pool, run.id, options.owner, park)) ? { kind: "waiting" } : { kind: "lost" };
}

/**
 * Inngest's onFailure: called once after the final attempt fails, with the
 * failure event (`data.event` is the original). Its steps are memoised under
 * their own prefix. It cannot park: a failed run is not resumed.
 */
async function runOnFailure(
  pool: Pool,
  fn: RegisteredFunction,
  run: JobRunRow,
  options: ExecuteOptions,
  error: unknown,
  steps: Map<string, unknown>,
): Promise<void> {
  const err = error instanceof Error ? error : new Error(String(error));
  const failureEvent: JobFailureEvent = {
    id: `${run.id}:failure`,
    name: JOB_FAILURE_EVENT_NAME,
    ts: Date.now(),
    data: {
      function_id: fn.id,
      run_id: run.id,
      error: { name: err.name, message: err.message, stack: err.stack },
      event: run.event,
    },
  };
  const result = await invoke(
    (step) => fn.options.onFailure!({ event: failureEvent, step, error: err }),
    (park) => createStepTools({ pool, run, steps, prefix: "onFailure:", options, park }),
  );
  if (result.kind === "threw") {
    console.error("[jobs/postgres] onFailure handler of %s threw: %s", fn.id, errorText(result.error));
  } else if (result.kind === "parked") {
    console.error("[jobs/postgres] onFailure handler of %s tried to park; a failed run is not resumed.", fn.id);
  }
}
