// apps/web/lib/routing/image-gen-adapter.ts

/**
 * EP-INF-009c: Image generation execution adapter.
 *
 * Supports two provider branches:
 *   1. OpenAI-compatible — POST {baseUrl}/v1/images/generations
 *   2. Gemini — POST {baseUrl}/models/{modelId}:generateContent (with image output config)
 */

import type { AdapterRequest, AdapterResult, ExecutionAdapterHandler } from "./adapter-types";
import { InferenceError, classifyHttpError } from "@/lib/ai-inference";
import { isOpenAI } from "./provider-utils";
import { registerExecutionAdapter } from "./execution-adapter-registry";

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Extract the last user message text as the image prompt. */
function extractPrompt(request: AdapterRequest): string {
  for (let i = request.messages.length - 1; i >= 0; i--) {
    const msg = request.messages[i]!;
    if (msg.role === "user") {
      return typeof msg.content === "string"
        ? msg.content
        : JSON.stringify(msg.content);
    }
  }
  return request.systemPrompt || "Generate an image";
}

// ── Image Gen Adapter ───────────────────────────────────────────────────────

export const imageGenAdapter: ExecutionAdapterHandler = {
  type: "image_gen",

  async execute(request: AdapterRequest): Promise<AdapterResult> {
    const { providerId, modelId, plan, provider } = request;
    const { baseUrl, headers } = provider;
    const prompt = extractPrompt(request);
    const settings = plan.providerSettings ?? {};

    let url: string;
    let body: Record<string, unknown>;
    let contentType = "application/json";

    if (providerId === "gemini") {
      // ── Gemini (Imagen via generateContent) ─────────────────────────
      url = `${baseUrl}/models/${modelId}:generateContent`;
      body = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ["IMAGE", "TEXT"],
          ...(settings.size ? { imageDimension: settings.size } : {}),
        },
      };
    } else {
      // ── OpenAI-compatible (DALL-E, gpt-image-1) ────────────────────
      const apiBase = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
      url = `${apiBase}/images/generations`;
      body = {
        model: modelId,
        prompt,
        n: 1,
        size: (settings.size as string) ?? "1024x1024",
        ...(settings.quality ? { quality: settings.quality } : {}),
        response_format: (settings.response_format as string) ?? "url",
      };
    }

    // ── Dispatch ──────────────────────────────────────────────────────────
    const startMs = Date.now();
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { ...headers, "Content-Type": contentType },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000), // image gen can be slow
      });
    } catch (e) {
      throw new InferenceError(
        `Network error calling ${providerId} image gen: ${e instanceof Error ? e.message : String(e)}`,
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
    let imageUrl = "";
    let revisedPrompt: string | undefined;

    if (providerId === "gemini") {
      // Gemini: candidates[0].content.parts[] — look for inlineData or text
      const candidates = data.candidates as Array<{
        content?: { parts?: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> };
      }> | undefined;
      const parts = candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        if (part.inlineData) {
          imageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        } else if (part.text) {
          revisedPrompt = part.text;
        }
      }
    } else {
      // OpenAI: data[0].url or data[0].b64_json
      const images = data.data as Array<{
        url?: string;
        b64_json?: string;
        revised_prompt?: string;
      }> | undefined;
      const first = images?.[0];
      if (first?.url) {
        imageUrl = first.url;
      } else if (first?.b64_json) {
        imageUrl = `data:image/png;base64,${first.b64_json}`;
      }
      revisedPrompt = first?.revised_prompt ?? undefined;
    }

    return {
      text: imageUrl,
      toolCalls: [],
      usage: { inputTokens: 0, outputTokens: 0 }, // image gen is per-request priced
      inferenceMs,
      raw: {
        imageUrl,
        ...(revisedPrompt ? { revisedPrompt } : {}),
        ...data,
      },
    };
  },
};

// ── Auto-register at import time ─────────────────────────────────────────────

registerExecutionAdapter(imageGenAdapter);
