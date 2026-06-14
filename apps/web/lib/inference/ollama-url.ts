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
