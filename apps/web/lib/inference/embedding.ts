import { getErrorMessage } from "@/lib/shared/get-error-message";
// Canonical CodeQL-registered log sanitiser (.github/codeql/dpf-sanitizers).
// Do NOT hand-roll a second one: only this function is modelled as a taint
// barrier, so a local copy would leave js/log-injection unbroken.
import { sanitizeForLog } from "@/lib/security/safe-log";
import { LocalProviderCapacityDeferredError } from "@/lib/routing/local-provider-capacity";
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
  const result = await generateEmbeddingDetailed(text);
  return result.status === "ok" ? result.embedding : null;
}

/**
 * Why a detailed variant exists (BI-339C441F root cause).
 *
 * generateEmbedding() collapses every unhappy path to null, and one of those
 * paths is not a failure at all. Embeddings are produced by the LOCAL provider,
 * so this function first calls assertLocalProviderCapacityAvailable(), which
 * throws LocalProviderCapacityDeferredError whenever a local-integration-ci
 * lease is active or queued. The catch turned that into null, callers turned
 * null into an empty result, and the platform reported "nothing matched".
 *
 * The effect is broad and was mistaken for an outage: while ANY session holds
 * or queues the single local-CI slot, every embedding consumer on the install
 * degrades at once — knowledge search, wiki/principle similarity, document
 * embeddings, and WWWD stance retrieval. The embedding backend is healthy the
 * whole time.
 *
 * `deferred` is a retryable capacity state and must never be reported as
 * "no results" or as a model failure. Callers that can wait should retry;
 * callers that cannot must say which one they hit.
 */
export type EmbeddingResult =
  | { status: "ok"; embedding: number[] }
  | { status: "deferred"; reason: string }
  | { status: "failed"; reason: string };

export async function generateEmbeddingDetailed(text: string): Promise<EmbeddingResult> {
  const baseUrl = getLlmBaseUrl();
  // Full-length attempt first, then shorter slices ONLY if the backend rejects
  // for size. Ordinary text still embeds at full fidelity; dense text degrades
  // to a shorter head instead of degrading to null.
  const lengths = [
    MAX_INPUT_LENGTH,
    ...OVERSIZE_RETRY_FRACTIONS.map((f) => Math.floor(MAX_INPUT_LENGTH * f)),
  ];

  try {
    // BI-0AA939DF / DI-7F674966B4B2: no host-capacity check here. Measured at
    // 10-20ms whether or not a local-CI gate holds the slot, with no observable
    // effect on the gate — so gating it only suppressed retrieval platform-wide
    // for the duration of every gate run. The `deferred` branch below is kept
    // for any caller that still raises the error; nothing here raises it now.

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
          // Numeric coercion is deliberate: these are lengths, not text, and
          // interpolating them as numbers keeps remote/user strings out of the
          // log line entirely (CodeQL js/log-injection).
          console.warn(
            `[embedding] backend rejected ${Number(truncated.length)} chars as over its batch limit; retrying at ${Number(nextLimit)}`,
          );
          continue;
        }
        console.warn(
          `[embedding] LLM inference returned ${Number(res.status)}${body ? `: ${sanitizeForLog(body.slice(0, 200))}` : ""}`,
        );
        return { status: "failed", reason: `the embedding backend returned HTTP ${Number(res.status)}` };
      }

      const data = (await res.json()) as {
        data?: Array<{ embedding?: number[] }>;
      };
      const embedding = data.data?.[0]?.embedding;
      if (!embedding || !Array.isArray(embedding)) {
        console.warn("[embedding] No embedding in response");
        return { status: "failed", reason: "the embedding backend returned no vector" };
      }

      if (attempt > 0) {
        console.warn(
          `[embedding] embedded a ${Number(truncated.length)}-char head after ${Number(attempt)} oversize retry/retries — text was denser than the char cap assumes`,
        );
      }
      return { status: "ok", embedding };
    }

    return { status: "failed", reason: "every input length was rejected as oversize" };
  } catch (e) {
    // A capacity deferral is NOT a failure — reporting it as one is what made
    // a busy host look like a broken embedding model.
    if (e instanceof LocalProviderCapacityDeferredError) {
      console.warn(`[embedding] deferred — ${e.reason}`);
      return { status: "deferred", reason: e.reason };
    }
    console.warn("[embedding] Failed:", getErrorMessage(e));
    return { status: "failed", reason: getErrorMessage(e) };
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
