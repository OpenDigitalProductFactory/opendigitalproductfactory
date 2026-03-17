// apps/web/lib/embedding.ts
// Generate text embeddings via Ollama local (nomic-embed-text, 768 dimensions).
// Cloud fallback interface architected but not implemented (EP-MEMORY-002).

const EMBEDDING_MODEL = "nomic-embed-text";
const MAX_INPUT_LENGTH = 8192;

function getOllamaUrl(): string {
  return process.env["OLLAMA_INTERNAL_URL"] ?? process.env["OLLAMA_URL"] ?? "http://localhost:11434";
}

/**
 * Generate a 768-dimensional embedding vector for the given text.
 * Returns null on failure (Ollama down, model not available, etc.)
 * — memory features degrade silently, chat still works.
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    const truncated = text.slice(0, MAX_INPUT_LENGTH);
    const baseUrl = getOllamaUrl();

    const res = await fetch(`${baseUrl}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        prompt: truncated,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      console.warn(`[embedding] Ollama returned ${res.status}`);
      return null;
    }

    const data = (await res.json()) as { embedding?: number[] };
    if (!data.embedding || !Array.isArray(data.embedding)) {
      console.warn("[embedding] No embedding in response");
      return null;
    }

    return data.embedding;
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
    const baseUrl = getOllamaUrl();
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return false;
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return data.models?.some((m) => m.name.startsWith(EMBEDDING_MODEL)) ?? false;
  } catch {
    return false;
  }
}
