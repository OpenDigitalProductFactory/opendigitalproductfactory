import { getErrorMessage } from "@/lib/shared/get-error-message";
// Canonical CodeQL-registered log sanitiser (.github/codeql/dpf-sanitizers).
// Do NOT hand-roll a second one: only this function is modelled as a taint
// barrier, so a local copy would leave js/log-injection unbroken.
import { sanitizeForLog } from "@/lib/security/safe-log";
import { LocalProviderCapacityDeferredError } from "@/lib/routing/local-provider-capacity";
import { readEnabledRoutingProvider, ProviderRoutingDeferredError } from "./provider-routing-admission";
import { providerInferenceFetch } from "./provider-inference-transport";
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
 * Keep retryable routing/capacity holds distinct from backend failures. Query
 * callers can report deferred retrieval instead of falsely reporting no match.
 * Operator pauses apply even though embeddings do not reserve the local-CI
 * compute slot (BI-0AA939DF, DI-7F674966B4B2; BI-1FB1C9B5).
 */
export type EmbeddingResult =
  | { status: "ok"; embedding: number[] }
  | { status: "deferred"; reason: string }
  | { status: "failed"; reason: string };

/**
 * Indexing can afford to wait out a cold load; an interactive search cannot.
 * Docker Model Runner unloads the embedder after a few idle minutes and
 * reloads it beside the completion model, and on 2026-10-15 every search
 * during two reloads waited the full 30 s and then failed
 * (BI-MCP-EFF-4F823E5B). Query-time callers pass a shorter `timeoutMs` and
 * answer some other way when it elapses.
 */
const DEFAULT_EMBED_TIMEOUT_MS = 30_000;

export async function generateEmbeddingDetailed(
  text: string,
  opts: { timeoutMs?: number } = {},
): Promise<EmbeddingResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_EMBED_TIMEOUT_MS;
  const baseUrl = getLlmBaseUrl();
  // Full-length attempt first, then shorter slices ONLY if the backend rejects
  // for size. Ordinary text still embeds at full fidelity; dense text degrades
  // to a shorter head instead of degrading to null.
  const lengths = [
    MAX_INPUT_LENGTH,
    ...OVERSIZE_RETRY_FRACTIONS.map((f) => Math.floor(MAX_INPUT_LENGTH * f)),
  ];

  try {
    // Operator intent is checked per attempt below. Embeddings remain exempt
    // from the host-capacity reservation so ordinary verification does not
    // suppress retrieval platform-wide.

    for (let attempt = 0; attempt < lengths.length; attempt++) {
      const limit = lengths[attempt]!;
      const truncated = text.slice(0, limit);

      // Each retry is a new dispatch: re-read operator intent immediately.
      await readEnabledRoutingProvider("local");
      const res = await providerInferenceFetch(`${baseUrl}/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: truncated,
        }),
        signal: AbortSignal.timeout(timeoutMs),
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
    if (e instanceof ProviderRoutingDeferredError) {
      return { status: "deferred", reason: e.reason };
    }
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
    const res = await providerInferenceFetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return false;
    const data = (await res.json()) as { data?: Array<{ id: string }> };
    return data.data?.some((m) => m.id.includes("nomic-embed-text") || m.id.includes("embed")) ?? false;
  } catch {
    return false;
  }
}
