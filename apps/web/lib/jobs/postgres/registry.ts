/**
 * Functions routed to the owned Postgres engine (BI-85E6EF14).
 *
 * Pure and dependency-free, so `jobs.createFunction` can record a function
 * synchronously at module load without pulling `pg` into every job module.
 * The worker reads this registry; senders never need it.
 */
import type { JobFunction, JobFunctionOptions, JobHandler } from "../types";
import { assertSupportedExpression } from "./expressions";

/** Inngest's default when a function names no retry count. */
export const DEFAULT_RETRIES = 3;

export type RegisteredFunction = {
  id: string;
  options: JobFunctionOptions<string>;
  handler: JobHandler<unknown>;
  eventNames: string[];
  crons: string[];
};

const POSTGRES_FUNCTION = Symbol.for("dpf.jobs.postgres-function");

const registry = new Map<string, RegisteredFunction>();

/** Record a function for the Postgres engine and return its opaque handle. */
export function registerPostgresFunction(
  options: JobFunctionOptions<string>,
  handler: JobHandler<unknown>,
): JobFunction {
  const eventNames: string[] = [];
  const crons: string[] = [];
  for (const trigger of options.triggers) {
    if ("event" in trigger) eventNames.push(trigger.event);
    else crons.push(trigger.cron);
  }
  // Refuse at registration what the engine could not evaluate at run time.
  for (const constraint of Array.isArray(options.concurrency) ? options.concurrency : options.concurrency ? [options.concurrency] : []) {
    if (constraint.key) assertSupportedExpression(constraint.key, "key");
  }
  registry.set(options.id, { id: options.id, options, handler, eventNames, crons });
  return { id: () => options.id, [POSTGRES_FUNCTION]: true } as JobFunction;
}

/** True for a handle the Postgres engine owns (the Inngest serve endpoint skips these). */
export function isPostgresFunction(fn: JobFunction): boolean {
  return Boolean((fn as unknown as Record<symbol, unknown>)[POSTGRES_FUNCTION]);
}

export function registeredFunction(id: string): RegisteredFunction | undefined {
  return registry.get(id);
}

export function registeredFunctions(): RegisteredFunction[] {
  return [...registry.values()];
}

/** Test seam: forget every registration. */
export function resetPostgresRegistry(): void {
  registry.clear();
}
