// apps/web/lib/routing/chat-adapter.ts

/**
 * EP-INF-008b: Default "chat" execution adapter.
 *
 * Extracts the per-provider HTTP dispatch logic from callProvider() into a
 * standalone adapter implementing the ExecutionAdapterHandler interface.
 *
 * Supports three provider branches:
 *   1. Anthropic  — POST {baseUrl}/messages
 *   2. Gemini     — POST {baseUrl}/models/{modelId}:generateContent
 *   3. OpenAI-compatible (everything else) — POST {apiBase}/v1/chat/completions
 */

import type { AdapterRequest, AdapterResult, ExecutionAdapterHandler, ToolCallEntry } from "./adapter-types";
import {
  InferenceError,
  classifyHttpError,
  extractAnthropicToolCalls,
  extractOpenAIToolCalls,
  formatMessageForAnthropic,
  formatMessageForOpenAI,
} from "@/lib/ai-inference";
import { isAnthropic } from "./provider-utils";
import { registerExecutionAdapter } from "./execution-adapter-registry";

// ─── Gemini part types ───────────────────────────────────────────────────────

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  executableCode?: { language: string; code: string };
  codeExecutionResult?: { outcome: string; output: string };
}

// ─── Chat Adapter ────────────────────────────────────────────────────────────

export const chatAdapter: ExecutionAdapterHandler = {
  type: "chat",

  async execute(request: AdapterRequest): Promise<AdapterResult> {
    const { providerId, modelId, plan, provider, messages, systemPrompt, tools } = request;
    const { baseUrl, headers } = provider;

    // Build provider-specific request
    let chatUrl: string;
    let body: Record<string, unknown>;

    if (isAnthropic(providerId)) {
      // ── Anthropic ──────────────────────────────────────────────────────
      chatUrl = `${baseUrl}/messages`;
      body = {
        model: modelId,
        max_tokens: plan.maxTokens,
        system: systemPrompt,
        messages: messages
          .filter((m) => m.role !== "system")
          .map((m) => formatMessageForAnthropic(m)),
      };

      // Apply thinking config
      if (plan.providerSettings?.thinking) {
        (body as Record<string, unknown>).thinking = plan.providerSettings.thinking;
      }
      // Apply temperature
      if (plan.temperature !== undefined) {
        (body as Record<string, unknown>).temperature = plan.temperature;
      }

      // Anthropic tools: convert OpenAI format → Anthropic format
      if (tools && tools.length > 0) {
        body.tools = tools.map((t) => {
          const fn = (t as { function?: { name?: string; description?: string; parameters?: unknown } }).function;
          return fn ? { name: fn.name, description: fn.description, input_schema: fn.parameters } : t;
        });
      }

      // Merge providerTools (e.g. computer use) into tools array
      const providerTools = plan.providerSettings?.providerTools as Array<Record<string, unknown>> | undefined;
      if (providerTools && providerTools.length > 0) {
        body.tools = [...((body.tools as Array<Record<string, unknown>>) ?? []), ...providerTools];
      }

    } else if (providerId === "gemini") {
      // ── Gemini ─────────────────────────────────────────────────────────
      chatUrl = `${baseUrl}/models/${modelId}:generateContent`;

      const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
      if (systemPrompt) {
        contents.push({ role: "user", parts: [{ text: systemPrompt }] });
        contents.push({ role: "model", parts: [{ text: "Understood. I will follow these instructions." }] });
      }
      for (const m of messages) {
        if (m.role === "tool") continue; // Gemini doesn't support tool role
        const textContent = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
        contents.push({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: textContent }] });
      }

      body = { contents };

      // Apply generation config
      if (plan.maxTokens) {
        (body as Record<string, unknown>).generationConfig = {
          ...((body as Record<string, unknown>).generationConfig as Record<string, unknown> ?? {}),
          maxOutputTokens: plan.maxTokens,
        };
      }
      if (plan.temperature !== undefined) {
        (body as Record<string, unknown>).generationConfig = {
          ...((body as Record<string, unknown>).generationConfig as Record<string, unknown> ?? {}),
          temperature: plan.temperature,
        };
      }

      // Merge providerTools (e.g. code_execution, google_search_retrieval)
      const providerTools = plan.providerSettings?.providerTools as Array<Record<string, unknown>> | undefined;
      if (providerTools && providerTools.length > 0) {
        body.tools = [...((body.tools as Array<Record<string, unknown>>) ?? []), ...providerTools];
      }

    } else if (providerId === "chatgpt") {
      // ── ChatGPT Subscription (Responses API via chatgpt.com/backend-api) ─
      chatUrl = `${baseUrl}/codex/responses`;

      // Responses API format: input array + instructions (system prompt)
      const input = messages.map((m) => formatMessageForOpenAI(m));

      body = {
        model: modelId,
        input,
        store: false,
        stream: true,
        ...(systemPrompt ? { instructions: systemPrompt } : {}),
      };

      // Apply temperature
      if (plan.temperature !== undefined) {
        (body as Record<string, unknown>).temperature = plan.temperature;
      }

    } else {
      // ── OpenAI-compatible ──────────────────────────────────────────────
      const apiBase = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
      chatUrl = `${apiBase}/chat/completions`;

      const allMessages = [
        { role: "system" as const, content: systemPrompt },
        ...messages.map((m) => formatMessageForOpenAI(m)),
      ];

      body = {
        model: modelId,
        messages: allMessages,
        max_tokens: plan.maxTokens,
        keep_alive: -1,
      };

      // Apply temperature
      if (plan.temperature !== undefined) {
        (body as Record<string, unknown>).temperature = plan.temperature;
      }
      // Apply reasoning_effort
      if (plan.providerSettings?.reasoning_effort) {
        (body as Record<string, unknown>).reasoning_effort = plan.providerSettings.reasoning_effort;
      }
      // Apply tool_choice
      if (plan.toolPolicy?.toolChoice && tools && tools.length > 0) {
        (body as Record<string, unknown>).tool_choice = plan.toolPolicy.toolChoice;
      }
      // Pass tools through (already in OpenAI format)
      if (tools && tools.length > 0) {
        body.tools = tools;
      }
    }

    // ── Dispatch ────────────────────────────────────────────────────────────
    const startMs = Date.now();
    let res: Response;
    try {
      res = await fetch(chatUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      });
    } catch (e) {
      throw new InferenceError(
        `Network error calling ${providerId}: ${e instanceof Error ? e.message : String(e)}`,
        "network",
        providerId,
      );
    }
    const inferenceMs = Date.now() - startMs;

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw classifyHttpError(res.status, providerId, errBody, res.headers);
    }

    // ChatGPT Responses API requires stream:true — collect SSE into final response
    let data: Record<string, unknown>;
    if (providerId === "chatgpt") {
      const rawText = await res.text();
      // SSE format: lines starting with "data: " followed by JSON, ending with "data: [DONE]"
      // The last event before [DONE] with type "response.completed" contains the full response
      const lines = rawText.split("\n");
      let lastCompleted: Record<string, unknown> | null = null;
      let lastDelta = "";
      for (const line of lines) {
        if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
        try {
          const parsed = JSON.parse(line.slice(6)) as Record<string, unknown>;
          if (parsed.type === "response.completed" && parsed.response) {
            lastCompleted = parsed.response as Record<string, unknown>;
          }
          // Collect text deltas as fallback
          if (parsed.type === "response.output_text.delta" && typeof parsed.delta === "string") {
            lastDelta += parsed.delta;
          }
        } catch { /* skip malformed lines */ }
      }
      data = lastCompleted ?? { output: [{ type: "message", content: [{ type: "output_text", text: lastDelta }] }] };
    } else {
      data = await res.json() as Record<string, unknown>;
    }

    // ── Extract text, tool calls, and usage ──────────────────────────────
    let text: string;
    let toolCalls: ToolCallEntry[] = [];
    let inputTokens: number;
    let outputTokens: number;

    if (isAnthropic(providerId)) {
      // Anthropic response
      const contentBlocks = data.content as Array<{ type?: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }> | undefined;
      text = contentBlocks?.filter((b) => b.type === "text").map((b) => b.text ?? "").join("") ?? "";
      toolCalls = extractAnthropicToolCalls(contentBlocks ?? []);

      const usage = (data.usage as Record<string, number>) ?? {};
      inputTokens = usage.input_tokens ?? 0;
      outputTokens = usage.output_tokens ?? 0;

    } else if (providerId === "gemini") {
      // Gemini response
      const candidates = data.candidates as Array<{ content?: { parts?: GeminiPart[] } }> | undefined;
      const parts = candidates?.[0]?.content?.parts ?? [];

      // Extract text from all part types (text, executableCode, codeExecutionResult)
      const textParts: string[] = [];
      for (const part of parts) {
        if (part.text) {
          textParts.push(part.text);
        } else if (part.executableCode) {
          textParts.push(`\`\`\`${part.executableCode.language?.toLowerCase() ?? "code"}\n${part.executableCode.code}\n\`\`\``);
        } else if (part.codeExecutionResult) {
          textParts.push(`Output: ${part.codeExecutionResult.output}`);
        }
        // functionCall parts are extracted as tool calls, not text
        if (part.functionCall) {
          toolCalls.push({
            id: `gemini_${Math.random().toString(36).slice(2, 9)}`,
            name: part.functionCall.name,
            arguments: part.functionCall.args ?? {},
          });
        }
      }
      text = textParts.join("\n");

      const usageMetadata = (data.usageMetadata as Record<string, number>) ?? {};
      inputTokens = usageMetadata.promptTokenCount ?? 0;
      outputTokens = usageMetadata.candidatesTokenCount ?? 0;

    } else if (providerId === "chatgpt") {
      // ChatGPT Responses API response format
      // { output: [{ type: "message", content: [{ type: "output_text", text }] }] }
      const output = data.output as Array<{
        type?: string;
        content?: Array<{ type?: string; text?: string }>;
      }> | undefined;
      const messageParts = output?.filter((item) => item.type === "message") ?? [];
      text = messageParts
        .flatMap((item) => item.content ?? [])
        .filter((c) => c.type === "output_text")
        .map((c) => c.text ?? "")
        .join("");

      const usage = typeof data.usage === "object" && data.usage !== null
        ? data.usage as Record<string, number>
        : {};
      inputTokens = (usage as Record<string, number>).input_tokens ?? 0;
      outputTokens = (usage as Record<string, number>).output_tokens ?? 0;

    } else {
      // OpenAI-compatible response
      const msg = (data.choices as Array<{
        message?: {
          content?: string;
          reasoning?: string;
          tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
        };
      }>)?.[0]?.message;
      text = msg?.content || msg?.reasoning || "";

      if (msg?.tool_calls && msg.tool_calls.length > 0) {
        toolCalls = extractOpenAIToolCalls(msg.tool_calls);
      }

      const usage = typeof data.usage === "object" && data.usage !== null
        ? data.usage as Record<string, number>
        : {};
      const readUsage = (...keys: string[]): number => {
        for (const key of keys) {
          const value = (usage as Record<string, unknown>)[key];
          if (typeof value === "number") return value;
        }
        return 0;
      };
      inputTokens = readUsage("input_tokens", "prompt_tokens");
      outputTokens = readUsage("output_tokens", "completion_tokens");
    }

    return {
      text,
      toolCalls,
      usage: { inputTokens, outputTokens },
      inferenceMs,
    };
  },
};

// ── Auto-register at import time ─────────────────────────────────────────────

registerExecutionAdapter(chatAdapter);
