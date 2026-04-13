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
  extractTextualToolCalls,
  formatMessageForAnthropic,
  formatMessageForOpenAI,
  formatMessageForResponses,
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

type ResponsesMessagePart = {
  type?: string;
  text?: string;
};

function extractResponsesText(
  output: Array<{
    type?: string;
    content?: ResponsesMessagePart[];
  }> | undefined,
  outputText?: string,
): string {
  const text = (output ?? [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === "output_text" || part.type === "text")
    .map((part) => part.text ?? "")
    .join("");

  return text || outputText || "";
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

      // EP-INF-013: Map effort → extended thinking for Anthropic.
      // effort="low" (or absent) → no thinking parameter (default, fast).
      // effort="medium/high/max" → enable thinking with a token budget.
      // Explicit providerSettings.thinking takes precedence over effort.
      const effortBudgets: Record<string, number> = { medium: 8_000, high: 32_000, max: 64_000 };
      const effort = plan.providerSettings?.effort as string | undefined;
      if (plan.providerSettings?.thinking) {
        // Explicit thinking config overrides effort
        (body as Record<string, unknown>).thinking = plan.providerSettings.thinking;
        // Ensure max_tokens accommodates the explicitly set budget
        const explicitBudget = (plan.providerSettings.thinking as { budget_tokens?: number }).budget_tokens ?? 0;
        body.max_tokens = Math.max(plan.maxTokens, explicitBudget + 2_048);
        // Anthropic rejects temperature when thinking is enabled
        delete (body as Record<string, unknown>).temperature;
      } else if (effort && effort !== "low" && effortBudgets[effort]) {
        const budget = effortBudgets[effort]!;
        (body as Record<string, unknown>).thinking = { type: "enabled", budget_tokens: budget };
        // max_tokens must be >= budget_tokens; add 2 048 for output headroom
        body.max_tokens = Math.max(plan.maxTokens, budget + 2_048);
        // Anthropic rejects temperature when thinking is enabled
        delete (body as Record<string, unknown>).temperature;
      }

      // Apply temperature (only when thinking is NOT enabled — handled above)
      if (plan.temperature !== undefined && !(body as Record<string, unknown>).thinking) {
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

      // Convert OpenAI-format function tools to Gemini functionDeclarations format
      if (tools && tools.length > 0) {
        const functionDeclarations = tools
          .filter((t: Record<string, unknown>) => t.type === "function" && t.function)
          .map((t: Record<string, unknown>) => {
            const fn = t.function as Record<string, unknown>;
            return {
              name: fn.name,
              description: fn.description,
              parameters: fn.parameters,
            };
          });
        if (functionDeclarations.length > 0) {
          body.tools = [...((body.tools as Array<Record<string, unknown>>) ?? []), { functionDeclarations }];
        }
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
      const input = messages.flatMap((m) => formatMessageForResponses(m));

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
      // Convert OpenAI Chat Completions format tools to Responses API format
      // Responses API expects: tools: [{ type: "function", name, description, parameters }]
      if (tools && tools.length > 0) {
        body.tools = tools.map((t: Record<string, unknown>) => {
          if (t.type === "function" && t.function) {
            const fn = t.function as Record<string, unknown>;
            return { type: "function", name: fn.name, description: fn.description, parameters: fn.parameters };
          }
          return t;
        });
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
      // Apply reasoning_effort (explicit setting takes precedence over effort)
      // EP-INF-013: fall back to deriving from effort when not explicitly set.
      // OpenAI o-series models support "low"/"medium"/"high"; max → "high".
      if (plan.providerSettings?.reasoning_effort) {
        (body as Record<string, unknown>).reasoning_effort = plan.providerSettings.reasoning_effort;
      } else if (plan.providerSettings?.effort) {
        const effortMap: Record<string, string> = { low: "low", medium: "medium", high: "high", max: "high" };
        const mapped = effortMap[plan.providerSettings.effort as string];
        if (mapped) (body as Record<string, unknown>).reasoning_effort = mapped;
      }
      // Apply tool_choice
      if (plan.toolPolicy?.toolChoice && tools && tools.length > 0) {
        (body as Record<string, unknown>).tool_choice = plan.toolPolicy.toolChoice;
      }
      // Pass tools through in OpenAI format, stripping non-standard fields
      // (e.g. annotations) that some models reject or mishandle.
      if (tools && tools.length > 0) {
        body.tools = tools.map((t: Record<string, unknown>) => {
          if (t.type === "function" && t.function) {
            const fn = t.function as Record<string, unknown>;
            return { type: "function", function: { name: fn.name, description: fn.description, parameters: fn.parameters } };
          }
          return t;
        });
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
      let parsedEventCount = 0;
      const eventTypes = new Set<string>();
      for (const line of lines) {
        if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
        try {
          const parsed = JSON.parse(line.slice(6)) as Record<string, unknown>;
          parsedEventCount++;
          if (typeof parsed.type === "string") eventTypes.add(parsed.type);
          if (parsed.type === "response.completed" && parsed.response) {
            lastCompleted = parsed.response as Record<string, unknown>;
          }
          // Collect text deltas as fallback
          if (parsed.type === "response.output_text.delta" && typeof parsed.delta === "string") {
            lastDelta += parsed.delta;
          }
        } catch { /* skip malformed lines */ }
      }
      if (!lastCompleted && !lastDelta) {
        console.warn(`[chat-adapter] ChatGPT SSE: ${lines.length} lines, ${parsedEventCount} parsed events, types=[${[...eventTypes].join(",")}], rawLen=${rawText.length}, first200=${rawText.slice(0, 200)}`);
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
        content?: ResponsesMessagePart[];
      }> | undefined;
      const outputText = typeof data.output_text === "string" ? data.output_text : undefined;
      text = extractResponsesText(output, outputText);

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
        // Structured tool calls (standard OpenAI format)
        toolCalls = extractOpenAIToolCalls(msg.tool_calls);
      } else if (text && (text.includes("<tool_call>") || text.includes("<|tool_call>"))) {
        // Fallback: model runner didn't translate native tool-call markers to structured format.
        // Handles Gemma/Llama template variants that leak <tool_call> or <|tool_call> as text.
        const extracted = extractTextualToolCalls(text);
        toolCalls = extracted.toolCalls;
        text = extracted.cleanText;
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
