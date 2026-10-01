/**
 * The `@/lib/jobs` contract: the durable-job surface the platform is allowed
 * to use (spec docs/superpowers/specs/2026-09-25-postgres-durable-job-engine-design.md
 * §2 and §5.1).
 *
 * These types are the whole API. A function that reaches for an option or a
 * step tool outside them fails to compile — the point is that the engine
 * behind the facade (Inngest today, the owned Postgres engine next) only has
 * to implement what is written here. Widening any of these types is a design
 * decision against that spec, not a local convenience.
 *
 * Deliberately absent (spec §2, zero uses): `step.invoke`, `step.sendEvent`,
 * `step.ai`, `step.fetch`, throttle, rateLimit, debounce, batchEvents,
 * priority, singleton, idempotency, timeouts, middleware, trigger `if`
 * expressions, invoke triggers.
 */

// `Jsonify` is the one type still borrowed from the adapter's engine: a step's
// output crosses a durable store, so it comes back JSON-shaped. The Postgres
// engine stores step output as jsonb and keeps the same semantics; when the
// `inngest` package retires (spec §6 step 3) this becomes an owned type.
import type { Jsonify } from "inngest/types";

// ─── Events ──────────────────────────────────────────────────────────────

/** Event data as a handler receives it. Untyped at the wire, as today. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JobEventData = Record<string, any>;

/** An event as a handler receives it. */
export interface JobReceivedEvent<TName extends string = string, TData = JobEventData> {
  name: TName;
  data: TData;
  id: string;
  ts: number;
  v?: string;
}

/** The event a cron-triggered run receives. */
export const JOB_CRON_EVENT_NAME = "inngest/scheduled.timer";
export type JobCronEvent = JobReceivedEvent<typeof JOB_CRON_EVENT_NAME, { cron: string }>;

/** The event an `onFailure` handler receives; `data.event` is the original. */
export const JOB_FAILURE_EVENT_NAME = "inngest/function.failed";
export type JobFailureEvent = JobReceivedEvent<typeof JOB_FAILURE_EVENT_NAME>;

/**
 * An event to send. `id` is the send-side dedupe key: a second send with the
 * same id does not start a second run. `ts` (epoch milliseconds) records when
 * the event happened rather than when it was sent; the async-operation outbox
 * sets it (lib/execution/adapters/async-operation-events.ts), a use the
 * spec's §2 table does not list.
 */
export interface JobSendEvent<TName extends string = string> {
  name: TName;
  data?: JobEventData;
  id?: string;
  ts?: number;
}

export interface JobSendResult {
  ids: string[];
}

// ─── Triggers ────────────────────────────────────────────────────────────

export interface JobCronTrigger {
  cron: string;
}

export interface JobEventTrigger<TName extends string = string> {
  event: TName;
}

// ─── Function options ────────────────────────────────────────────────────

/** Retry counts in use (spec §2: 0–3, no custom backoff). */
export type JobRetries = 0 | 1 | 2 | 3;

/**
 * One concurrency constraint. `key` is an expression over the event
 * (`event.data.<field>`, or a constant string literal for a shared lane);
 * `scope: "account"` is the shared build-pipeline lane in `lib/queue/admission.ts`.
 *
 * `limit` is a number, not the literal `1` the spec's §2 table implies: six
 * functions run at limit 2 or 4 today and the account lane takes an operator
 * value. Phase 1 changes no behaviour, so the contract admits them; the
 * Postgres engine must honour limit N or those uses must change first.
 */
export interface JobConcurrency {
  limit: number;
  key?: string;
  scope?: "fn" | "env" | "account";
}

export type JobConcurrencyOption =
  | JobConcurrency
  | readonly [JobConcurrency]
  | readonly [JobConcurrency, JobConcurrency];

/** Cancel a running function when a matching event arrives. */
export interface JobCancelOn {
  event: string;
  /** Dotted path that must be equal on the trigger and the cancel event. */
  match: string;
}

export type JobTriggers<TName extends string> =
  | readonly JobEventTrigger<TName>[]
  | readonly JobCronTrigger[];

export interface JobFunctionOptions<TName extends string> {
  id: string;
  triggers: JobTriggers<TName>;
  retries?: JobRetries;
  concurrency?: JobConcurrencyOption;
  cancelOn?: readonly JobCancelOn[];
  onFailure?: (ctx: JobFailureContext) => unknown;
}

// ─── Steps ───────────────────────────────────────────────────────────────

/** A duration: milliseconds, or a string such as `"30m"`, `"60s"`, `"2h"`. */
export type JobDuration = number | string;

/** What a step returns once it has been through the durable store. */
export type JobStepOutput<TFn extends () => unknown> = Jsonify<
  TFn extends () => Promise<infer U>
    ? Awaited<U extends void ? null : U>
    : ReturnType<TFn> extends void
      ? null
      : ReturnType<TFn>
>;

export interface JobWaitForEventOptions<TName extends string> {
  event: TName;
  timeout: JobDuration;
  /** Expression over `event` (the trigger) and `async` (the awaited event). */
  if?: string;
}

/**
 * The step tools a handler may use. `run` is memoised: on replay a completed
 * step returns its stored output without calling `fn` again.
 */
export interface JobStepTools {
  run<TFn extends () => unknown>(id: string, fn: TFn): Promise<JobStepOutput<TFn>>;
  sleep(id: string, duration: JobDuration): Promise<void>;
  sleepUntil(id: string, time: Date | string): Promise<void>;
  waitForEvent<const TName extends string>(
    id: string,
    options: JobWaitForEventOptions<TName>,
  ): Promise<JobReceivedEvent<TName> | null>;
}

// ─── Handlers ────────────────────────────────────────────────────────────

/** The event a handler receives for the given trigger event names. */
export type JobTriggerEvent<TName extends string> = [TName] extends [never]
  ? JobCronEvent
  : JobReceivedEvent<TName>;

export interface JobContext<TEvent> {
  event: TEvent;
  step: JobStepTools;
}

export interface JobFailureContext extends JobContext<JobFailureEvent> {
  error: Error;
}

export type JobHandler<TEvent> = (ctx: JobContext<TEvent>) => unknown;

/**
 * A registered durable function. Opaque: only the registry and the serve
 * endpoint consume it. `id()` is the function id as registered.
 */
export interface JobFunction {
  id(): string;
}

// ─── Client ──────────────────────────────────────────────────────────────

export interface JobsClient {
  createFunction<const TName extends string = never>(
    options: JobFunctionOptions<TName>,
    handler: JobHandler<JobTriggerEvent<TName>>,
  ): JobFunction;
  send(payload: JobSendEvent | readonly JobSendEvent[]): Promise<JobSendResult>;
}
