/**
 * BI-F0005EB0 (EP-BS-UX-HARDENING) — bounded, transient-only retry wrapper for a
 * coworker inference turn.
 *
 * The reported dead-end is a Build Studio ideate/scout turn whose FIRST inference
 * fails (e.g. `API Error: Unable to connect to API (ConnectionRefused)`) and is
 * then dropped, stalling the build. Before we surface the "Retry the AI call"
 * affordance to the human, give the request a couple of automatic retries with
 * backoff — a brief connection hiccup or a short rate-limit often clears on its
 * own, so the non-technical user never sees a failure at all.
 *
 * Deliberately conservative:
 *   - only TRANSIENT failure kinds are retried (connection / rate-limit /
 *     provider-unavailable) — a config gap or empty-response won't fix itself, so
 *     retrying just burns compute;
 *   - bounded attempt count + explicit backoff schedule;
 *   - caller opts in per-phase (`enabled`), so non-ideate/scout turns are
 *     unchanged.
 *
 * Pure and injectable (`sleep`) so the retry decision is unit-testable without
 * real timers or a real inference call.
 */

import { classifyInferenceFailure, isTransientInferenceFailure } from "./inference-failure";

const DEFAULT_BACKOFF_MS = [500, 1500];

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export type TransientInferenceRetryOptions = {
  /** When false, run once and return — no classification, no retry. */
  enabled: boolean;
  /**
   * Backoff schedule in ms; length caps the number of RETRIES (attempts beyond
   * the first). Defaults to [500, 1500] (up to 2 retries → 3 attempts total).
   */
  backoffMs?: number[];
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Observability hook fired before each retry. */
  onRetry?: (attempt: number, kind: string) => void;
};

/**
 * Run `run()` and, when it returns a transient inference-failure `content`,
 * retry it with backoff up to the configured cap. Returns the LAST result
 * (whether success or a final failure) — the caller's downstream persist-time
 * guard sanitizes a lingering failure and the custodian surfaces the retry
 * affordance.
 */
export async function runWithTransientInferenceRetry<T extends { content: string }>(
  run: () => Promise<T>,
  opts: TransientInferenceRetryOptions,
): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep;
  const backoff = opts.backoffMs ?? DEFAULT_BACKOFF_MS;

  let result = await run();
  if (!opts.enabled) {
    return result;
  }

  for (let attempt = 0; attempt < backoff.length; attempt++) {
    const kind = classifyInferenceFailure(result.content);
    if (!isTransientInferenceFailure(kind)) {
      return result;
    }
    opts.onRetry?.(attempt + 1, kind as string);
    await sleep(backoff[attempt] ?? 0);
    result = await run();
  }

  return result;
}
