// apps/web/lib/routing/async-adapter.ts

/**
 * EP-INF-009d: Async/long-running execution adapter.
 *
 * Starts a long-running inference operation (e.g., Google Deep Research
 * via Interactions API) and returns immediately with an operation ID.
 * Does NOT wait for completion — the caller polls via pollAsyncOperation().
 *
 * Currently supports:
 *   1. Google Gemini — Interactions API create/get
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

function isManagedInteractionsAgent(modelId: string): boolean {
  // Antigravity interactions additionally require a remote environment. Keep
  // this slice limited to the configured Deep Research agent family rather
  // than dispatching an incomplete Antigravity request.
  return modelId.startsWith("deep-research-");
}

function normalizeInteractionsBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

// ── Async Adapter ───────────────────────────────────────────────────────────

export const asyncAdapter: ExecutionAdapterHandler = {
  type: "async",

  async execute(request: AdapterRequest): Promise<AdapterResult> {
    const { providerId, modelId, provider } = request;
    const { baseUrl, headers } = provider;
    const prompt = extractPrompt(request);
    if (providerId !== "gemini") {
      throw new InferenceError(
        `Provider ${providerId} does not support the async execution adapter`,
        "provider_error",
        providerId,
      );
    }

    // ── Google Interactions API (models and managed agents) ───────────
    // The returned Interaction.id is an opaque poll handle. It is not a
    // Google long-running-operation name and must never be interpreted as a
    // URL by the poller.
    const url = `${normalizeInteractionsBaseUrl(baseUrl)}/interactions`;
    const modelOrAgent = isManagedInteractionsAgent(modelId)
      ? { agent: modelId }
      : { model: modelId.replace(/^models\//, "") };
    const body: Record<string, unknown> = {
      ...modelOrAgent,
      input: prompt,
      ...(request.systemPrompt.trim().length > 0
        ? { system_instruction: request.systemPrompt }
        : {}),
      background: true,
    };

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

    // Interactions API pattern: { id, object: "interaction", status }. Require
    // the resource discriminator and a documented status so a generic response
    // ID can never become durable polling authority.
    const interactionStatuses = new Set([
      "in_progress",
      "requires_action",
      "completed",
      "failed",
      "cancelled",
      "incomplete",
    ]);
    if ((data.object !== undefined && data.object !== "interaction")
      || !interactionStatuses.has(String(data.status))) {
      throw new InferenceError(
        `Gemini returned an invalid interaction response`,
        "provider_error",
        providerId,
      );
    }
    operationId = typeof data.id === "string"
      && data.id.trim().length > 0
      && data.id.trim() === data.id
      ? data.id
      : null;

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
      asyncOperation: {
        status: "accepted",
        providerOperationId: operationId,
      },
      raw: {
        providerResponse: data,
      },
    };
  },
};

// ── Auto-register at import time ─────────────────────────────────────────────

registerExecutionAdapter(asyncAdapter);
