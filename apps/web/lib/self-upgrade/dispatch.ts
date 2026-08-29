// Publishing the self-upgrade event and running the upgrade are two steps with
// different safety properties, and they must not share one retry policy.
//
// The runner (`selfUpgradeManual`) sets `retries: 0` deliberately: a promotion
// re-entered halfway is worse than one that failed. That reasoning does not
// extend to the enqueue, which is idempotent from the operator's point of view
// and has not yet touched the install — no quiescence drain, no image pull, no
// container recreate.
//
// Live: SUR-D71E8971 was marked permanently `failed` by one connect timeout to
// inngest:8288 while inngest was up and processing 4-9 events per minute
// throughout, and the identical dispatch succeeded unchanged on the next attempt
// (SUR-946F62CC). One connect attempt lost a race against a 10s timeout and cost
// the operator a deploy on an install that was, at the time, running a
// three-day-old image (BI-965E65B7).

import { getErrorMessage } from "@/lib/shared/get-error-message";

/** Node/undici transport failure codes worth another attempt. */
const RETRYABLE_CODES = new Set([
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
]);

export const DISPATCH_MAX_ATTEMPTS = 3;
export const DISPATCH_BACKOFF_MS = [250, 1_000] as const;

function codesOf(err: unknown): string[] {
  const codes: string[] = [];
  let current: unknown = err;
  // undici nests the real cause: TypeError("fetch failed") -> { cause: { code } }.
  for (let depth = 0; current && typeof current === "object" && depth < 5; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") codes.push(code);
    current = (current as { cause?: unknown }).cause;
  }
  return codes;
}

/**
 * A transport failure never reached the queue, so retrying cannot double-publish.
 *
 * An HTTP status means the event API answered and rejected us — a bad event key
 * or a malformed payload is a real misconfiguration that must surface now, not
 * three attempts from now.
 */
export function isRetryableDispatchError(err: unknown): boolean {
  if (err && typeof err === "object" && "status" in err) {
    const status = (err as { status?: unknown }).status;
    if (typeof status === "number") return false;
  }
  if (codesOf(err).some((code) => RETRYABLE_CODES.has(code))) return true;
  // undici surfaces a bare TypeError("fetch failed") when the cause is stripped.
  return /fetch failed/i.test(getErrorMessage(err));
}

/**
 * Carries how many attempts were actually made, so the failure message cannot
 * claim three tries when a non-retryable error stopped it at one.
 */
export class DispatchFailure extends Error {
  readonly attempts: number;

  constructor(cause: unknown, attempts: number) {
    super(getErrorMessage(cause));
    this.name = "DispatchFailure";
    this.cause = cause;
    this.attempts = attempts;
  }
}

/**
 * Human-readable failure that names the endpoint and the error class, so run
 * history answers "is inngest up, or is the network wedged?" without a log dive.
 * `queue-dispatch-failed: fetch failed` answered neither.
 */
export function describeDispatchFailure(err: unknown, endpoint: string): string {
  const attempts = err instanceof DispatchFailure ? err.attempts : 1;
  const underlying = err instanceof DispatchFailure ? err.cause : err;
  const codes = codesOf(underlying);
  const cls = codes.length > 0 ? codes[codes.length - 1] : "unknown-error";
  const plural = attempts === 1 ? "attempt" : "attempts";
  return `${getErrorMessage(underlying)} (endpoint ${endpoint}, ${cls}, after ${attempts} ${plural})`;
}

/**
 * Send with bounded retry on transport failures only. Returns the send result or
 * throws the last error once attempts are exhausted.
 *
 * The operator is watching a button, so the whole budget is a little over a
 * second — long enough to ride out a lost connect race, short enough that a real
 * outage still reports promptly.
 */
export async function sendWithTransientRetry<T>(
  send: () => Promise<T>,
  opts: { sleep?: (ms: number) => Promise<void>; maxAttempts?: number } = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? DISPATCH_MAX_ATTEMPTS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await send();
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts || !isRetryableDispatchError(err)) {
        throw new DispatchFailure(err, attempt);
      }
      await sleep(DISPATCH_BACKOFF_MS[attempt - 1] ?? DISPATCH_BACKOFF_MS.at(-1) ?? 1_000);
    }
  }
  throw new DispatchFailure(lastError, maxAttempts);
}

/** The address a dispatch failure should name. */
export function inngestEndpoint(): string {
  return process.env.INNGEST_BASE_URL?.trim() || "inngest event api";
}
