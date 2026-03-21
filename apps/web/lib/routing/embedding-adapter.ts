// apps/web/lib/routing/embedding-adapter.ts

/**
 * EP-INF-009c: Embedding execution adapter.
 *
 * Supports two provider branches:
 *   1. OpenAI-compatible — POST {baseUrl}/v1/embeddings
 *   2. Gemini — POST {baseUrl}/models/{modelId}:embedContent
 */

import type { AdapterRequest, AdapterResult, ExecutionAdapterHandler } from "./adapter-types";
import { InferenceError, classifyHttpError } from "@/lib/ai-inference";
import { registerExecutionAdapter } from "./execution-adapter-registry";

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Extract text to embed from the last user message. */
function extractText(request: AdapterRequest): string {
  for (let i = request.messages.length - 1; i >= 0; i--) {
    const msg = request.messages[i]!;
    if (msg.role === "user") {
      return typeof msg.content === "string"
        ? msg.content
        : JSON.stringify(msg.content);
    }
  }
  return "";
}

// ── Embedding Adapter ───────────────────────────────────────────────────────

export const embeddingAdapter: ExecutionAdapterHandler = {
  type: "embedding",

  async execute(request: AdapterRequest): Promise<AdapterResult> {
    const { providerId, modelId, plan, provider } = request;
    const { baseUrl, headers } = provider;
    const text = extractText(request);
    const settings = plan.providerSettings ?? {};

    let url: string;
    let body: Record<string, unknown>;

    if (providerId === "gemini") {
      // ── Gemini ─────────────────────────────────────────────────────────
      url = `${baseUrl}/models/${modelId}:embedContent`;
      body = {
        content: { parts: [{ text }] },
        ...(settings.taskType ? { taskType: settings.taskType } : {}),
      };
    } else {
      // ── OpenAI-compatible ──────────────────────────────────────────────
      const apiBase = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
      url = `${apiBase}/embeddings`;
      body = {
        model: modelId,
        input: text,
        encoding_format: "float",
        ...(typeof settings.dimensions === "number" ? { dimensions: settings.dimensions } : {}),
      };
    }

    // ── Dispatch ──────────────────────────────────────────────────────────
    const startMs = Date.now();
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      throw new InferenceError(
        `Network error calling ${providerId} embedding: ${e instanceof Error ? e.message : String(e)}`,
        "network",
        providerId,
      );
    }
    const inferenceMs = Date.now() - startMs;

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw classifyHttpError(res.status, providerId, errBody, res.headers);
    }

    const data = (await res.json()) as Record<string, unknown>;

    // ── Extract result ───────────────────────────────────────────────────
    let embedding: number[] = [];
    let inputTokens = 0;

    if (providerId === "gemini") {
      // Gemini: { embedding: { values: number[] } }
      const emb = data.embedding as { values?: number[] } | undefined;
      embedding = emb?.values ?? [];
    } else {
      // OpenAI: { data: [{ embedding: number[] }], usage: { prompt_tokens, total_tokens } }
      const items = data.data as Array<{ embedding?: number[] }> | undefined;
      embedding = items?.[0]?.embedding ?? [];
      const usage = data.usage as Record<string, number> | undefined;
      inputTokens = usage?.prompt_tokens ?? usage?.total_tokens ?? 0;
    }

    return {
      text: "", // embeddings aren't text
      toolCalls: [],
      usage: { inputTokens, outputTokens: 0 },
      inferenceMs,
      raw: {
        embedding,
        dimensions: embedding.length,
      },
    };
  },
};

// ── Auto-register at import time ─────────────────────────────────────────────

registerExecutionAdapter(embeddingAdapter);
