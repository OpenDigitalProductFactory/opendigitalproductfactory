// apps/web/lib/routing/async-adapter.ts

/**
 * EP-INF-009d: Async/long-running execution adapter.
 *
 * Starts a long-running inference operation (e.g., Google Deep Research
 * via Interactions API) and returns immediately with an operation ID.
 * Does NOT wait for completion — the caller polls via pollAsyncOperation().
 *
 * Currently supports:
 *   1. Google Gemini — startInteraction / operations polling
 */

import type { AdapterRequest, AdapterResult, ExecutionAdapterHandler } from "./adapter-types";
import { InferenceError, classifyHttpError } from "@/lib/ai-inference";
import { registerExecutionAdapter } from "./execution-adapter-registry";

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Extract the last user message text as the research prompt. */
function extractPrompt(request: AdapterRequest): string {
  for (let i = request.messages.length - 1; i >= 0; i--) {
    const msg = request.messages[i]!;
    if (msg.role === "user") {
      return typeof msg.content === "string"
        ? msg.content
        : JSON.stringify(msg.content);
    }
  }
  return request.systemPrompt || "Research this topic";
}

// ── Async Adapter ───────────────────────────────────────────────────────────

export const asyncAdapter: ExecutionAdapterHandler = {
  type: "async",

  async execute(request: AdapterRequest): Promise<AdapterResult> {
    const { providerId, modelId, plan, provider } = request;
    const { baseUrl, headers } = provider;
    const prompt = extractPrompt(request);
    const settings = plan.providerSettings ?? {};

    let url: string;
    let body: Record<string, unknown>;

    if (providerId === "gemini") {
      // ── Google Interactions API (Deep Research) ─────────────────────
      url = `${baseUrl}/models/${modelId}:startInteraction`;
      body = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        ...(settings.config ? { config: settings.config } : {}),
      };
    } else {
      // ── Generic async start — future providers ─────────────────────
      // Fallback: try standard endpoint with async flag
      const apiBase = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
      url = `${apiBase}/chat/completions`;
      body = {
        model: modelId,
        messages: [{ role: "user", content: prompt }],
        stream: false,
        ...(settings.async_mode ? { async_mode: settings.async_mode } : {}),
      };
    }

    // ── Dispatch start request ────────────────────────────────────────
    const startMs = Date.now();
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000), // start should be fast
      });
    } catch (e) {
      throw new InferenceError(
        `Network error starting async operation on ${providerId}: ${e instanceof Error ? e.message : String(e)}`,
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

    // ── Extract operation ID ──────────────────────────────────────────
    let operationId: string | null = null;

    if (providerId === "gemini") {
      // Google LRO pattern: { name: "operations/{id}", done: false }
      operationId = typeof data.name === "string" ? data.name : null;
    } else {
      // Generic: look for id or operation_id
      operationId = (data.id ?? data.operation_id ?? null) as string | null;
    }

    if (!operationId) {
      throw new InferenceError(
        `No operation ID returned from ${providerId} async start`,
        "provider_error",
        providerId,
      );
    }

    return {
      text: "", // No result yet
      toolCalls: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      inferenceMs,
      raw: {
        operationId,
        asyncStatus: "accepted",
        providerResponse: data,
      },
    };
  },
};

// ── Auto-register at import time ─────────────────────────────────────────────

registerExecutionAdapter(asyncAdapter);
