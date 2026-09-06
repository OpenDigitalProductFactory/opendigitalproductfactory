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
import { captureAnthropicWeeklyQuota } from "./cli-pool-status";
import { registerExecutionAdapter } from "./execution-adapter-registry";
import { extractToolCalls as extractTextualToolUse } from "./extract-tool-calls";
// BI-98572A51: the single-GPU admission lane is canonical in resource-lane.ts so
// chat AND the local build engine share ONE gate. Re-exported below for callers
// (and tests) that import it from here.
import { withLocalInferenceLock } from "@/lib/queue/resource-lane";
import { buildAnthropicSystem } from "./anthropic-cache";
import { parseOpenRouterRoutingEvidence } from "./provider-suitability/openrouter-policy";
import { resolveOpenAiCompatibleApiBase } from "./openai-base";
import {
  createInferenceTimeoutSignal,
  resolveInferenceRuntimePolicy,
} from "./local-inference-runtime-policy";

// ─── Inference HTTP timeouts ──────────────────────────────────────────────────
// The runtime-policy module separates the governed, deliberately slower 27B
// reviewer from generic local models. Both operator overrides and defaults stay
// bounded, while the reviewer always receives its approved ten-minute window.

// A single-GPU local endpoint (Docker Model Runner / Ollama) serves ONE request
// at a time. The platform routinely fires inference concurrently — reviewBuildPlan
// alone dispatches 3 reviewer calls in parallel, on top of the coworker's agentic
// loop — which makes those calls queue behind each other inside the endpoint,
// blow past the per-call timeout while still waiting, and 502 the endpoint under
// load. Observed live: "Both review agents failed to respond" on every local
// build because both reviewers aborted with "operation was aborted due to timeout".
// Serialize local inference so each call gets the full GPU and its timeout
// (created by the caller, inside this lock) covers real inference, not queue-wait.
// Cloud providers are unaffected — only providerId === "local" goes through it.
//
// This now delegates to the shared ResourceLane (EP-3516E23D Phase 2), which is
// the same single-slot FIFO serializer with two opt-in additions: a bounded queue
// depth (set DPF_LOCAL_INFERENCE_MAX_QUEUE_DEPTH to reject over-capacity calls with
// a LaneBusyError — the honest busy signal, BI-6112DDE0 — instead of letting them
// pile up and time out while waiting), and flow telemetry so lane wait/process
// time is measurable. Both are gated on that env: UNSET ⇒ unbounded serialize with
// no telemetry writes, byte-for-byte the prior behavior.
// Canonical home is resource-lane.ts (shared with the local build engine,
// BI-98572A51); re-exported so existing importers/tests of this module are
// unaffected.
export { withLocalInferenceLock };

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

const GEMINI_UNSUPPORTED_SCHEMA_KEYS = new Set([
  "$defs",
  "$id",
  "$schema",
  "additionalProperties",
  "allOf",
  "anyOf",
  "const",
  "default",
  "definitions",
  "dependencies",
  "dependentRequired",
  "dependentSchemas",
  "deprecated",
  "else",
  "examples",
  "if",
  "not",
  "patternProperties",
  "propertyNames",
  "readOnly",
  "then",
  "unevaluatedProperties",
  "uniqueItems",
  "writeOnly",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Collapse a JSON Schema union type to the scalar Gemini's proto accepts.
 *
 * `type: ["string", "null"]` is ordinary JSON Schema and every other provider
 * takes it. Gemini's functionDeclarations are proto-backed, where `type` is a
 * singular field, so a list is rejected outright:
 *
 *   Invalid JSON payload received. Unknown name "type" at
 *   'tools[0].function_declarations[15].parameters.properties[9].value':
 *   Proto field is not repeating, cannot start list.
 *
 * Returns the first non-null member as the type, and whether "null" was among
 * them so the caller can set `nullable`. First-member choice is deliberate:
 * a union's leading entry is the one authors write as the real type, with
 * "null" appended, so it is the closest single type to the author's intent.
 */
function collapseGeminiUnionType(value: unknown): { type: unknown; nullable: boolean } | null {
  if (!Array.isArray(value)) return null;
  const members = value.filter((entry): entry is string => typeof entry === "string");
  const concrete = members.filter((entry) => entry !== "null");
  const nullable = members.length !== concrete.length;
  // An all-null union carries no type at all; leaving it out is the only honest
  // rendering, and Gemini treats a missing type as unconstrained.
  if (concrete.length === 0) return nullable ? { type: undefined, nullable: true } : null;
  return { type: concrete[0], nullable };
}

function sanitizeGeminiSchemaNode(value: unknown, propertyMap = false): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeGeminiSchemaNode(item));
  }
  if (!isRecord(value)) {
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (!propertyMap && GEMINI_UNSUPPORTED_SCHEMA_KEYS.has(key)) {
      continue;
    }
    // BI-3907AF35: a union `type` reaches Gemini as a list and fails the whole
    // request, so every coworker holding such a tool cannot run at all — not
    // just for that tool. Collapse it here rather than asking every tool author
    // to avoid ordinary JSON Schema.
    if (!propertyMap && key === "type") {
      const collapsed = collapseGeminiUnionType(child);
      if (collapsed) {
        if (collapsed.type !== undefined) sanitized[key] = collapsed.type;
        if (collapsed.nullable) sanitized.nullable = true;
        continue;
      }
    }
    sanitized[key] = sanitizeGeminiSchemaNode(child, !propertyMap && key === "properties");
  }
  return sanitized;
}


function toGeminiFunctionDeclarations(tools: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return tools
    .filter((t) => t.type === "function" && t.function)
    .map((t) => {
      const fn = t.function as Record<string, unknown>;
      return {
        name: fn.name,
        description: fn.description,
        parameters: sanitizeGeminiSchemaNode(fn.parameters),
      };
    });
}

/** Exported for test: the union collapse is the whole point of the fix. */
export const __testing = { sanitizeGeminiSchemaNode, toGeminiFunctionDeclarations };

// ─── Chat Adapter ────────────────────────────────────────────────────────────

export const chatAdapter: ExecutionAdapterHandler = {
  type: "chat",

  async execute(request: AdapterRequest): Promise<AdapterResult> {
    const { providerId, modelId, plan, provider, messages, systemPrompt, tools } = request;
    const { baseUrl, headers } = provider;
    let requestHeaders = headers;

    // Build provider-specific request
    let chatUrl: string;
    let body: Record<string, unknown>;

    if (isAnthropic(providerId)) {
      // ── Anthropic ──────────────────────────────────────────────────────
      chatUrl = `${baseUrl}/messages`;
      body = {
        model: modelId,
        max_tokens: plan.maxTokens,
        // BI-79A5C00F: emit a cache_control breakpoint on the stable system
        // prefix (split on SYSTEM_PROMPT_DYNAMIC_BOUNDARY); plain string when
        // no boundary is present, so non-assembled prompts are unchanged.
        system: buildAnthropicSystem(systemPrompt),
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
        if (plan.toolPolicy.toolChoice) {
          body.tool_choice = {
            type: plan.toolPolicy.toolChoice === "required"
              ? "any"
              : plan.toolPolicy.toolChoice,
          };
        }
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
        const functionDeclarations = toGeminiFunctionDeclarations(tools);
        if (functionDeclarations.length > 0) {
          body.tools = [...((body.tools as Array<Record<string, unknown>>) ?? []), { functionDeclarations }];
          if (plan.toolPolicy.toolChoice) {
            body.toolConfig = {
              functionCallingConfig: {
                mode: plan.toolPolicy.toolChoice === "required"
                  ? "ANY"
                  : plan.toolPolicy.toolChoice.toUpperCase(),
                ...(plan.toolPolicy.toolChoice === "required"
                  ? { allowedFunctionNames: functionDeclarations.map((tool) => String(tool.name)) }
                  : {}),
              },
            };
          }
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
        if (plan.toolPolicy.toolChoice) body.tool_choice = plan.toolPolicy.toolChoice;
      }

    } else {
      // ── OpenAI-compatible ──────────────────────────────────────────────
      const selectedBaseUrl = providerId === "openrouter" && plan.openRouterPolicy?.requiredBaseUrl
        ? plan.openRouterPolicy.requiredBaseUrl
        : baseUrl;
      const apiBase = resolveOpenAiCompatibleApiBase(selectedBaseUrl);
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

      if (providerId === "openrouter" && plan.openRouterPolicy) {
        // One construction point makes the typed policy load-bearing for every
        // OpenRouter chat/completions call; callers cannot separately construct
        // an unbounded body after suitability has compiled the plan.
        body.provider = plan.openRouterPolicy.providerSettings;
        requestHeaders = {
          ...headers,
          "X-OpenRouter-Metadata": "enabled",
        };
      }

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
      // The AbortSignal is created inside the thunk so, for serialized local
      // calls, the timeout clock starts when the call actually dispatches — not
      // while it waits its turn in the local-inference lock.
      const doFetch = () => request.fetchImpl(chatUrl, {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify(body),
        signal: createInferenceTimeoutSignal(resolveInferenceRuntimePolicy(providerId, modelId, {
          defaultTimeoutMs: process.env.DPF_INFERENCE_TIMEOUT_MS,
          localTimeoutMs: process.env.DPF_LOCAL_INFERENCE_TIMEOUT_MS,
        }).effectiveTimeoutMs),
      });
      res = providerId === "local" ? await withLocalInferenceLock(doFetch) : await doFetch();
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

    // Topology-free REAL weekly-quota capture: a subscription/OAuth Anthropic
    // response carries anthropic-ratelimit-unified-7d-* headers with the true
    // remaining weekly allocation. Persist them for the capacity-drain policy.
    // No-op when absent (API-key traffic isn't on the weekly meter).
    if (isAnthropic(providerId)) {
      void captureAnthropicWeeklyQuota(providerId, res.headers);
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

    const openRouterRoutingEvidence = providerId === "openrouter"
      ? parseOpenRouterRoutingEvidence(data.openrouter_metadata)
      : undefined;
    if (
      plan.openRouterPolicy?.requireUnderlyingProviderEvidence &&
      openRouterRoutingEvidence?.underlyingProviderEvidence !== "returned"
    ) {
      throw new InferenceError(
        "Restricted OpenRouter response did not return underlying-provider metadata; the result was withheld.",
        "provider_error",
        providerId,
      );
    }

    // ── Extract text, tool calls, and usage ──────────────────────────────
    let text: string;
    let toolCalls: ToolCallEntry[] = [];
    let inputTokens: number;
    let outputTokens: number;
    let cacheCreationInputTokens: number | undefined;
    let cacheReadInputTokens: number | undefined;
    // Provider stop signal → normalized truncation flag. The agentic loop reads
    // this to avoid returning a max_tokens-truncated fragment as a final answer
    // (BI-1D144CC1). Each branch below maps its provider-specific value.
    let truncated = false;
    /** Separate thinking channel, when the provider emits one (BI-1E77BEE3). */
    let reasoning: string | undefined;

    if (isAnthropic(providerId)) {
      // Anthropic response
      const contentBlocks = data.content as Array<{ type?: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }> | undefined;
      text = contentBlocks?.filter((b) => b.type === "text").map((b) => b.text ?? "").join("") ?? "";
      toolCalls = extractAnthropicToolCalls(contentBlocks ?? []);
      truncated = data.stop_reason === "max_tokens";

      const usage = (data.usage as Record<string, number>) ?? {};
      inputTokens = usage.input_tokens ?? 0;
      outputTokens = usage.output_tokens ?? 0;
      // Prompt-cache token counts (only present when cache is active; 0 means no cache activity)
      if ((usage.cache_creation_input_tokens ?? 0) > 0) cacheCreationInputTokens = usage.cache_creation_input_tokens;
      if ((usage.cache_read_input_tokens ?? 0) > 0) cacheReadInputTokens = usage.cache_read_input_tokens;

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

      truncated = candidates?.[0] != null
        && (candidates[0] as { finishReason?: string }).finishReason === "MAX_TOKENS";

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
      // Responses API signals truncation via status="incomplete" +
      // incomplete_details.reason="max_output_tokens".
      truncated = data.status === "incomplete"
        && (data.incomplete_details as { reason?: string } | undefined)?.reason === "max_output_tokens";

      const usage = typeof data.usage === "object" && data.usage !== null
        ? data.usage as Record<string, number>
        : {};
      inputTokens = (usage as Record<string, number>).input_tokens ?? 0;
      outputTokens = (usage as Record<string, number>).output_tokens ?? 0;

    } else {
      // OpenAI-compatible response
      const choice = (data.choices as Array<{
        finish_reason?: string;
        message?: {
          content?: string;
          reasoning?: string;
          /** llama.cpp / Docker Model Runner name for the separate thinking channel. */
          reasoning_content?: string;
          tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
        };
      }>)?.[0];
      const msg = choice?.message;

      // Capture reasoning as its OWN channel (BI-1E77BEE3). Providers disagree on
      // the field name: llama.cpp / Docker Model Runner emit `reasoning_content`,
      // other OpenAI-compatible providers emit `reasoning`.
      reasoning = msg?.reasoning_content || msg?.reasoning || undefined;

      // The answer is `content`. Falling back to reasoning is a LAST resort for a
      // provider that returns only a thinking channel — without it such a turn
      // renders blank. When content exists, reasoning must never displace it.
      text = msg?.content || reasoning || "";
      truncated = choice?.finish_reason === "length";

      if (msg?.tool_calls && msg.tool_calls.length > 0) {
        // Structured tool calls (standard OpenAI format)
        toolCalls = extractOpenAIToolCalls(msg.tool_calls);
      } else if (text && (text.includes("<tool_call>") || text.includes("<|tool_call>"))) {
        // Fallback: model runner didn't translate native tool-call markers to structured format.
        // Handles Gemma/Llama template variants that leak <tool_call> or <|tool_call> as text.
        const extracted = extractTextualToolCalls(text);
        toolCalls = extracted.toolCalls;
        text = extracted.cleanText;
      } else if (text && text.includes('"tool_use"')) {
        // Fallback 2: local/Docker Model Runner (Gemma, Llama) emits the
        // canonical Anthropic-style {"type":"tool_use",...} JSON as plain
        // content rather than a structured tool_calls field. Without this
        // every tool-requiring turn that fallback-routes to local is a
        // silent dead-end: the agentic loop sees toolCalls=0 and gives up.
        // Share the CLI adapters' extractor so the behaviour is identical
        // regardless of provider.
        const textualUse = extractTextualToolUse(text);
        if (textualUse.length > 0) {
          toolCalls = textualUse;
          console.log(`[tool-trace] adapter=chat rescued=${toolCalls.length} names=${JSON.stringify(toolCalls.map(c => c.name))} provider=local-or-chat`);
        }
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
      // Only present when the provider actually offered a separate channel;
      // consumers read undefined as "not offered", not "the model had none".
      ...(reasoning ? { reasoning } : {}),
      usage: { inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens },
      inferenceMs,
      truncated,
      ...(openRouterRoutingEvidence
        ? { raw: { openRouterRoutingEvidence } }
        : {}),
    };
  },
};

// ── Auto-register at import time ─────────────────────────────────────────────

registerExecutionAdapter(chatAdapter);
