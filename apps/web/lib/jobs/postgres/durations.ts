import type { JobDuration } from "../types";

const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

/**
 * Milliseconds for a facade duration: a number of milliseconds, or a string
 * such as `"30m"`, `"10s"`, `"2h"` or `"1h30m"`, as Inngest accepts them.
 */
export function durationMs(duration: JobDuration): number {
  if (typeof duration === "number") {
    if (!Number.isFinite(duration) || duration < 0) throw new Error(`Invalid job duration ${duration}.`);
    return duration;
  }
  const text = duration.trim();
  if (/^\d+$/.test(text)) return Number(text);
  let total = 0;
  let consumed = "";
  for (const match of text.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h|d|w)/g)) {
    total += Number(match[1]) * UNIT_MS[match[2]!]!;
    consumed += match[0];
  }
  if (!consumed || consumed !== text.replace(/\s+/g, "")) throw new Error(`Invalid job duration ${JSON.stringify(duration)}.`);
  return total;
}

/** Retry delay after `attempt` failures: exponential from 10 s, capped at 10 min. */
export function retryBackoffMs(attempt: number): number {
  return Math.min(10_000 * 2 ** Math.max(0, attempt - 1), 600_000);
}

/** A positive integer from the environment, or the fallback when unset, blank or invalid (compose passes unset vars as ""). */
export function positiveIntFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value?.trim() ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
