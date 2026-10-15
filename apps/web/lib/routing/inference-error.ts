// apps/web/lib/routing/inference-error.ts
// The inference error contract: InferenceError and the HTTP-status classifier.
// A leaf (no Prisma, no adapter registry) in routing, the innermost context, so
// the execution adapters can throw it without importing inference/ai-inference.ts,
// which imports them for registration.
// ai-inference.ts re-exports both names, so its public API is unchanged and
// `instanceof InferenceError` sees one class everywhere.

import {
  classifyProviderCapacity,
  type ProviderCapacityClassification,
} from "./provider-capacity";

export class InferenceError extends Error {
  constructor(
    message: string,
    public readonly code: "network" | "auth" | "rate_limit" | "overloaded" | "model_not_found" | "provider_error" | "transient" | "billing" | "request_too_large" | "required_terminal_writer_not_enforceable",
    public readonly providerId: string,
    public readonly statusCode?: number,
    public readonly headers?: Record<string, string>,
    public readonly rawBody?: string,
    public readonly capacity?: ProviderCapacityClassification,
    /**
     * True when a LOCAL pool check refused the call before it left the process,
     * because the pool is known-saturated until a known reset time.
     *
     * This is not an upstream 429. Nothing was asked of the provider, and
     * waiting on this endpoint cannot make it answer sooner — the reset is
     * wall-clock. The fallback chain uses this to skip its wait-and-retry and
     * move to the next provider immediately, which is what the pool check was
     * always trying to cause (BI-52C6FE5A).
     */
    public readonly localPoolExhausted?: boolean,
  ) {
    super(message);
    this.name = "InferenceError";
  }
}

export function classifyHttpError(
  status: number,
  providerId: string,
  body: string,
  responseHeaders?: Headers,
): InferenceError {
  // Extract rate-limit-relevant headers
  const rateLimitHeaders: Record<string, string> | undefined = responseHeaders
    ? Object.fromEntries(
        [...responseHeaders.entries()].filter(
          ([k]) =>
            k.startsWith("x-ratelimit") ||
            k.startsWith("anthropic-ratelimit") ||
            k === "retry-after",
        ),
      )
    : undefined;

  const headers = rateLimitHeaders && Object.keys(rateLimitHeaders).length > 0
    ? rateLimitHeaders
    : undefined;
  const capacity = classifyProviderCapacity({
    providerId,
    statusCode: status,
    headers: responseHeaders ?? headers,
    bodyText: body,
    now: new Date(),
  });

  if (status === 401 || status === 403) {
    return new InferenceError(`Auth failed for ${providerId}: ${body.slice(0, 200)}`, "auth", providerId, status, headers, body, capacity);
  }
  if (status === 402 || capacity.state === "billing_action_required" || capacity.state === "unsupported_plan") {
    return new InferenceError(`Billing error on ${providerId}: ${body.slice(0, 200)}`, "billing", providerId, status, headers, body, capacity);
  }
  if (status === 413) {
    return new InferenceError(`Request too large for ${providerId}: ${body.slice(0, 200)}`, "request_too_large", providerId, status, headers, body, capacity);
  }
  if (status === 429) {
    return new InferenceError(`Rate limited by ${providerId}`, "rate_limit", providerId, status, headers, body, capacity);
  }
  if (status === 529 || /\b529\b|overloaded/i.test(body)) {
    return new InferenceError(`Provider overloaded on ${providerId}: ${body.slice(0, 300)}`, "overloaded", providerId, status, headers, body, capacity);
  }
  if (status === 404) {
    return new InferenceError(`Model not found on ${providerId}: ${body.slice(0, 200)}`, "model_not_found", providerId, status, headers, body, capacity);
  }
  if (status === 408 || status === 500 || status === 502 || status === 503 || status === 504) {
    return new InferenceError(`Transient error (${status}) from ${providerId}: ${body.slice(0, 200)}`, "transient", providerId, status, headers, body, capacity);
  }
  return new InferenceError(`HTTP ${status} from ${providerId}: ${body.slice(0, 300)}`, "provider_error", providerId, status, headers, body, capacity);
}
