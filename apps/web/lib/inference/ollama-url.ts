// apps/web/lib/ollama-url.ts
// Pure helper — returns the base URL for the local LLM inference provider.
// Supports Docker Model Runner (default) and Ollama (legacy).

type ProviderUrlFields = {
  providerId: string;
  baseUrl: string | null;
  endpoint: string | null;
};

/**
 * Returns the OpenAI-compatible base URL for the local LLM provider.
 * Priority: LLM_BASE_URL env → provider config → Docker Model Runner default.
 */
export function getOllamaBaseUrl(provider?: ProviderUrlFields | null): string {
  if (process.env.LLM_BASE_URL) {
    return process.env.LLM_BASE_URL;
  }
  if (process.env.OLLAMA_INTERNAL_URL) {
    return process.env.OLLAMA_INTERNAL_URL;
  }
  return provider?.endpoint ?? provider?.baseUrl ?? "http://model-runner.docker.internal/v1";
}

/**
 * Resolve the endpoint to preflight for an explicitly-selected OpenCode
 * provider. The default local provider (`local`, or none) keeps the env-first
 * resolution of getOllamaBaseUrl — LLM_BASE_URL / OLLAMA_INTERNAL_URL govern
 * the *default* local endpoint and must not regress. A distinct selected
 * provider — e.g. `ollama` at http://localhost:11434 — uses its OWN
 * endpoint/baseUrl, so a config-time preflight probes the box the operator
 * actually picked instead of silently borrowing the Docker Model Runner
 * default. Fixes the case where selecting a seeded "Ollama" provider reported a
 * green "Ready" that was really Docker Model Runner's status.
 */
export function resolveOpencodeProviderBaseUrl(provider?: ProviderUrlFields | null): string {
  const explicit = provider?.endpoint ?? provider?.baseUrl ?? null;
  if (provider && provider.providerId !== "local" && explicit) {
    return explicit;
  }
  return getOllamaBaseUrl(provider);
}

/**
 * Returns the root URL for the local provider's Ollama-native management API
 * (`/api/tags`, `/api/pull`, `/api/version`).
 *
 * Docker Model Runner serves those endpoints at the host root
 * (e.g. http://model-runner.docker.internal), NOT under the OpenAI-compatible
 * `/v1` (or `/engines/v1`) inference prefix that getOllamaBaseUrl() returns.
 * Appending `/api/tags` directly to the `/v1` base yields `/v1/api/tags`, which
 * 404s on Docker Model Runner — silently disabling first-run model auto-pull.
 * Strip the inference suffix so `/api/*` calls hit the management root. A real
 * Ollama base URL (no `/v1` suffix) is returned unchanged.
 */
export function getOllamaApiRoot(provider?: ProviderUrlFields | null): string {
  return getOllamaBaseUrl(provider).replace(/\/(engines\/)?v1\/?$/, "");
}
