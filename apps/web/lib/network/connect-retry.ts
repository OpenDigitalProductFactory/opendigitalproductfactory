/**
 * Retry a request whose connection never opened (BI-ACAA91E5).
 *
 * On 2026-11-11 this host reached api.github.com on 1 connect in 20. One
 * failed connect lost a build's pull request and three publications of a
 * passed review status, because each call tried exactly once.
 *
 * Only connect-phase failures are retried: no request bytes were sent, so the
 * retry cannot repeat a write. A reset or timeout after the request left is
 * not retried here; the caller owns that decision.
 */
const CONNECT_FAILURE_CODES = new Set([
  "UND_ERR_CONNECT_TIMEOUT", "ETIMEDOUT", "ECONNREFUSED", "ENETUNREACH",
  "EHOSTUNREACH", "EAI_AGAIN", "ENOTFOUND", "ETIMEOUT",
]);

/** True when the error, or anything in its cause chain, is a failed connect or lookup. */
export function isConnectFailure(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current && typeof current === "object"; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && CONNECT_FAILURE_CODES.has(code)) return true;
    const errors = (current as { errors?: unknown }).errors;
    if (Array.isArray(errors) && errors.length > 0 && errors.every(isConnectFailure)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export type ConnectRetryOptions = Readonly<{
  attempts?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}>;

/** Run `request`, retrying with doubling delay while the connection fails to open. */
export async function withConnectRetry<T>(request: () => Promise<T>, options: ConnectRetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 6;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  for (let attempt = 1; ; attempt++) {
    try {
      return await request();
    } catch (error) {
      if (attempt >= attempts || !isConnectFailure(error)) throw error;
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
}
