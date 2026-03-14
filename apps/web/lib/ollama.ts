// apps/web/lib/ollama.ts

type ProviderUrlFields = {
  providerId: string;
  baseUrl: string | null;
  endpoint: string | null;
};

/**
 * Returns the root Ollama URL for native API calls (/api/tags, /api/ps).
 * The registry baseUrl is "http://localhost:11434/v1" (OpenAI-compatible),
 * but native health/management endpoints live at the root without /v1.
 */
export function getOllamaBaseUrl(provider?: ProviderUrlFields | null): string {
  if (process.env.OLLAMA_INTERNAL_URL) {
    return process.env.OLLAMA_INTERNAL_URL;
  }
  const raw = provider?.endpoint ?? provider?.baseUrl ?? "http://localhost:11434";
  return raw.replace(/\/v1\/?$/, "");
}
