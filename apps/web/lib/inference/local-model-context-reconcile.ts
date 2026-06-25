// apps/web/lib/inference/local-model-context-reconcile.ts
//
// Self-heal the local GENERATION model's served context window.
//
// Docker Model Runner stores a per-model `context-size` runtime override, but a
// Docker Desktop / DMR restart wipes it back to the model card's small default
// (qwen3-coder ships 4096). At 4096 EVERY local coworker turn overflows —
// `exceed_context_size_error: request (24234 tokens) exceeds context size (4096)`
// — because a real turn (capped tool surface + system prompt + history) is ~20k+.
// The first-run bootstrap raises it once (bootstrap-first-run.ts), but nothing
// re-asserts it, so the very first restart silently bricks every coworker.
//
// This reconcile re-asserts RECOMMENDED_BUILD_CONTEXT_TOKENS. It is wired into
// instrumentation `register()` to run on every boot (catches the common case:
// Docker Desktop restart restarts the portal too) plus a periodic net (catches a
// DMR-only restart while the portal stays up). Idempotent + best-effort: never
// throws, and only POSTs when the TRUE served context (read from DMR's
// `_configure` endpoint, NOT the static `/v1/models` metadata which always
// reports the 4k card default) is below target — so the steady state is two
// cheap GETs and zero writes.

import { prisma } from "@dpf/db";
import { getOllamaBaseUrl, getOllamaApiRoot } from "./ollama-url";
import { isEmbeddingModelId, RECOMMENDED_BUILD_CONTEXT_TOKENS } from "./local-model-policy";
import { getServedContextTokens, setServedContextTokens } from "./dmr-runtime-config";

export type ContextReconcileStatus =
  | "raised" // was below target; override applied (and ModelProfile synced)
  | "ok" // already at/above target; no write
  | "deferred" // below target but DMR refused the write (runner active); applies on next load
  | "no-model" // no local generation model installed
  | "unsupported" // local runtime exposes no context-size configuration API
  | "unreachable"; // local runtime / models endpoint not reachable

export type ContextReconcileResult = {
  status: ContextReconcileStatus;
  modelId: string | null;
  /** Served context BEFORE the reconcile — null when DMR has no override set. */
  before: number | null;
  /** Served context AFTER the reconcile (target when raised). */
  after: number | null;
  reason: string | null;
};

/**
 * Ensure the local generation model serves at least RECOMMENDED_BUILD_CONTEXT_TOKENS.
 * Best-effort and idempotent — safe to call on every boot and on an interval.
 */
export async function reconcileLocalModelContext(
  fetchImpl: typeof fetch = fetch,
): Promise<ContextReconcileResult> {
  const none = (status: ContextReconcileStatus, reason: string | null): ContextReconcileResult => ({
    status,
    modelId: null,
    before: null,
    after: null,
    reason,
  });

  try {
    const oaiBase = getOllamaBaseUrl().replace(/\/$/, "");
    const apiRoot = getOllamaApiRoot();
    const modelsUrl = oaiBase.endsWith("/v1") ? `${oaiBase}/models` : `${oaiBase}/v1/models`;

    // Find the installed generation model (the embedder is left alone).
    let modelId: string | null = null;
    try {
      const res = await fetchImpl(modelsUrl, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return none("unreachable", `models endpoint returned HTTP ${res.status}`);
      const body = (await res.json()) as { data?: Array<{ id?: string }> };
      modelId = (body.data ?? []).find((m) => m.id && !isEmbeddingModelId(m.id))?.id ?? null;
    } catch (err) {
      return none("unreachable", `models endpoint unreachable: ${(err as Error).message}`);
    }
    if (!modelId) return none("no-model", "no local generation model installed");

    // TRUTH source for the served context — the `_configure` override, NOT the
    // static `/v1/models` context_window (which always reports the 4k card default).
    const served = await getServedContextTokens(apiRoot, modelId, fetchImpl);
    if (!served.supported) {
      return { status: "unsupported", modelId, before: null, after: null, reason: served.reason };
    }
    const before = served.contextTokens; // null = no override set (DMR default ~4k)
    if (before !== null && before >= RECOMMENDED_BUILD_CONTEXT_TOKENS) {
      return { status: "ok", modelId, before, after: before, reason: null };
    }

    const applied = await setServedContextTokens(apiRoot, modelId, RECOMMENDED_BUILD_CONTEXT_TOKENS, fetchImpl);
    if (!applied.ok) {
      // DMR refuses while a runner is active; the override applies on next load.
      return { status: "deferred", modelId, before, after: null, reason: applied.reason };
    }

    // Keep the routing source of truth (ModelProfile.maxContextTokens) consistent
    // with what DMR now serves. Best-effort — a DB hiccup must not fail the heal.
    await prisma.modelProfile
      .updateMany({
        where: { providerId: { in: ["local", "ollama"] }, modelId },
        data: { maxContextTokens: applied.contextTokens ?? RECOMMENDED_BUILD_CONTEXT_TOKENS },
      })
      .catch(() => {});

    return {
      status: "raised",
      modelId,
      before,
      after: applied.contextTokens ?? RECOMMENDED_BUILD_CONTEXT_TOKENS,
      reason: null,
    };
  } catch (err) {
    return none("unreachable", `context reconcile failed: ${(err as Error).message}`);
  }
}
