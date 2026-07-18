import { ConnectorError } from "./error";

export interface ConnectorRetryPolicy {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
}

export interface RetryConnectorOperationInput<T> {
  operation(idempotencyKey?: string): Promise<T>;
  idempotencyKey?: string;
  signal?: AbortSignal;
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  jitter?: (delayMs: number, attempt: number) => number;
}

function abortError(): Error {
  const error = new Error("Connector operation was cancelled.");
  error.name = "AbortError";
  return error;
}

export async function defaultConnectorSleep(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortError();
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(abortError());
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function retryable(error: unknown): error is ConnectorError {
  return error instanceof ConnectorError &&
    (error.kind === "rate_limited" || error.kind === "upstream_unavailable");
}

export async function retryConnectorOperation<T>(
  policy: ConnectorRetryPolicy,
  input: RetryConnectorOperationInput<T>,
): Promise<T> {
  const sleep = input.sleep ?? defaultConnectorSleep;
  const jitter = input.jitter ?? ((delay: number) => delay);
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    if (input.signal?.aborted) throw abortError();
    try {
      return await input.operation(input.idempotencyKey);
    } catch (error) {
      const canRetry = attempt < policy.maxAttempts && Boolean(input.idempotencyKey) && retryable(error);
      if (!canRetry) throw error;
      const exponential = Math.min(policy.maxDelayMs, policy.initialDelayMs * (2 ** (attempt - 1)));
      const requested = error.retryAfterMs === undefined
        ? exponential
        : Math.min(policy.maxDelayMs, Math.max(0, error.retryAfterMs));
      const delay = Math.max(0, Math.min(policy.maxDelayMs, jitter(requested, attempt)));
      await sleep(delay, input.signal);
    }
  }
  throw new Error("Unreachable connector retry state.");
}
