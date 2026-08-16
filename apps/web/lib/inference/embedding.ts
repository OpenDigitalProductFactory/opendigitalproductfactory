import { getErrorMessage } from "@/lib/shared/get-error-message";
import { assertLocalProviderCapacityAvailable } from "@/lib/routing/local-provider-capacity";
// apps/web/lib/embedding.ts
// Generate text embeddings via local LLM inference (Docker Model Runner or compatible).
// Uses OpenAI-compatible /v1/embeddings endpoint.

const EMBEDDING_MODEL = "ai/nomic-embed-text-v1.5";
// The embedding backend (Docker Model Runner / llama.cpp, nomic-embed-text)
// runs with an n_ubatch of 512 tokens; inputs over ~2000 chars (~512 tokens)
// are rejected with HTTP 500. Cap input length to stay under that batch limit
// so substantial text embeds (truncated to its most representative head)
// instead of silently failing (return null) — which is what left memory,
// knowledge, documents AND the WWMD wiki kernel un-embedded. Override with
// EMBED_MAX_INPUT_CHARS for a backend configured with a larger batch.
// (BI-30AA6B76. Chunk+mean-pool for full-body fidelity is future work.)
const MAX_INPUT_LENGTH = Number(process.env["EMBED_MAX_INPUT_CHARS"]) || 1700;

// The char cap above is a PROXY for a token limit, and the proxy leaks. 1700
// chars is under 512 tokens only while text averages >3.3 chars/token; dense
// content (code, ids, slugs, tables, markdown punctuation) runs nearer 2.8, so
// the same 1700 chars becomes ~600 tokens and the backend rejects it.
//
// Observed live on the canonical runtime 2026-08-15/16 — inputs of 520, 550 and
// 599 tokens rejected with:
//   "input (599 tokens) is too large to process. increase the physical batch
//    size (current batch size: 512)"
// preceded at every embedder load by:
//   "embeddings enabled with n_batch (2048) > n_ubatch (512)"
//   "setting n_batch = n_ubatch = 512 to avoid assertion failure"
//
// Lowering the cap far enough to be safe for the densest text would
// over-truncate ordinary prose, losing fidelity on every embed to protect
// against a minority of inputs. Instead: keep the generous cap and RETRY at
// progressively shorter slices when the backend rejects for size. That is
// self-correcting — it needs no chars-per-token constant to be right, and it
// adapts if a backend is configured with a different batch.
//
// DMR exposes only `context-size` via /engines/_configure (verified 2026-08-16:
// the embedder has no entry at all), so raising n_ubatch is NOT available as a
// fix from the platform side. Truncation is the only lever we hold.
// (BI-633845B0, refining BI-30AA6B76's char cap.)
const OVERSIZE_RETRY_FRACTIONS = [0.6, 0.35] as const;

/** True when a failed embed response is the backend's batch-size rejection. */
export function isOversizeRejection(status: number, body: string): boolean {
  if (status < 400) return false;
  return /too large to process|batch size|n_ubatch|exceeds the physical batch/i.test(body);
}

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
  const baseUrl = getLlmBaseUrl();
  // Full-length attempt first, then shorter slices ONLY if the backend rejects
  // for size. Ordinary text still embeds at full fidelity; dense text degrades
  // to a shorter head instead of degrading to null.
  const lengths = [
    MAX_INPUT_LENGTH,
    ...OVERSIZE_RETRY_FRACTIONS.map((f) => Math.floor(MAX_INPUT_LENGTH * f)),
  ];

  try {
    await assertLocalProviderCapacityAvailable();

    for (let attempt = 0; attempt < lengths.length; attempt++) {
      const limit = lengths[attempt]!;
      const truncated = text.slice(0, limit);

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
        const body = await res.text().catch(() => "");
        const nextLimit = lengths[attempt + 1];
        if (nextLimit !== undefined && isOversizeRejection(res.status, body)) {
          console.warn(
            `[embedding] backend rejected ${truncated.length} chars as over its batch limit; retrying at ${nextLimit}`,
          );
          continue;
        }
        console.warn(
          `[embedding] LLM inference returned ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
        );
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

      if (attempt > 0) {
        console.warn(
          `[embedding] embedded a ${truncated.length}-char head after ${attempt} oversize retry/retries — text was denser than the char cap assumes`,
        );
      }
      return embedding;
    }

    return null;
  } catch (e) {
    console.warn("[embedding] Failed:", getErrorMessage(e));
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
