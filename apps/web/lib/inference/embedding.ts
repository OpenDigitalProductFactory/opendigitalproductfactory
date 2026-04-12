// apps/web/lib/embedding.ts
// Generate text embeddings via local LLM inference (Docker Model Runner or compatible).
// Uses OpenAI-compatible /v1/embeddings endpoint.

const EMBEDDING_MODEL = "ai/nomic-embed-text-v1.5";
const MAX_INPUT_LENGTH = 8192;

function getLlmBaseUrl(): string {
  return (
    process.env["LLM_BASE_URL"] ??
    process.env["OLLAMA_INTERNAL_URL"] ??
    "http://model-runner.docker.internal/v1"
  );
}

/**
 * Generate a 768-dimensional embedding vector for the given text.
 * Returns null on failure (inference down, model not available, etc.)
 * — memory features degrade silently, chat still works.
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    const truncated = text.slice(0, MAX_INPUT_LENGTH);
    const baseUrl = getLlmBaseUrl();

    const res = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: truncated,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      console.warn(`[embedding] LLM inference returned ${res.status}`);
      return null;
    }

    const data = (await res.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const embedding = data.data?.[0]?.embedding;
    if (!embedding || !Array.isArray(embedding)) {
      console.warn("[embedding] No embedding in response");
      return null;
    }

    return embedding;
  } catch (e) {
    console.warn("[embedding] Failed:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

/**
 * Check if the embedding model is available.
 */
export async function isEmbeddingAvailable(): Promise<boolean> {
  try {
    const baseUrl = getLlmBaseUrl();
    const res = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return false;
    const data = (await res.json()) as { data?: Array<{ id: string }> };
    return data.data?.some((m) => m.id.includes("nomic-embed-text") || m.id.includes("embed")) ?? false;
  } catch {
    return false;
  }
}
