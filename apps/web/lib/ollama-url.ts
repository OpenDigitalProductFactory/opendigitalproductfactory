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
