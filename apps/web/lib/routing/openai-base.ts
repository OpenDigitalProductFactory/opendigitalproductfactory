/**
 * Join an OpenAI-compatible base URL to its API root.
 *
 * Appends /v1 only when the base does not already carry a version segment.
 * Z.ai's endpoints (…/api/paas/v4, …/api/coding/paas/v4) are versioned at
 * /v4 — blindly appending /v1 produced …/v4/v1/chat/completions, a 404 the
 * fallback chain read as model-not-found and answered by auto-retiring every
 * Z.ai model (BI-B6B8C1F9, BI-PIR-3ef04aa9).
 */
export function resolveOpenAiCompatibleApiBase(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return /\/v\d+$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
}
