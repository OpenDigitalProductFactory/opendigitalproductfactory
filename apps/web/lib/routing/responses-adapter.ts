/**
 * Responses-backed execution adapter for OpenAI Codex and ChatGPT subscription
 * providers.
 */

import type { AdapterRequest, AdapterResult, ExecutionAdapterHandler, ToolCallEntry } from "./adapter-types";
import {
  InferenceError,
  classifyHttpError,
  formatMessageForResponses,
} from "@/lib/ai-inference";
import { registerExecutionAdapter } from "./execution-adapter-registry";

type ResponsesOutputItem =
  | {
      type?: string;
      content?: Array<{ type?: string; text?: string }>;
    }
  | {
      type?: string;
      call_id?: string;
      name?: string;
      arguments?: string;
    };

type ResponsesMessagePart = {
  type?: string;
  text?: string;
};

function isChatGptBackend(providerId: string, baseUrl: string): boolean {
  return providerId === "chatgpt" || baseUrl.includes("chatgpt.com/backend-api");
}

function buildResponsesUrl(providerId: string, baseUrl: string): string {
  if (isChatGptBackend(providerId, baseUrl)) {
    return `${baseUrl}/codex/responses`;
  }
  const apiBase = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
  return `${apiBase}/responses`;
}

function toResponsesTools(tools?: Array<Record<string, unknown>>): Array<Record<string, unknown>> | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((tool) => {
    if (tool.type === "function" && tool.function) {
      const fn = tool.function as Record<string, unknown>;
      return {
        type: "function",
        name: fn.name,
        description: fn.description,
        parameters: fn.parameters,
      };
    }
    return tool;
  });
}

function extractResponsesText(output: ResponsesOutputItem[] | undefined, outputText?: string): string {
  const text = (output ?? [])
    .filter((item) => item.type === "message")
    .flatMap((item) => "content" in item ? item.content ?? [] : [])
    .filter((part): part is ResponsesMessagePart => part.type === "output_text" || part.type === "text")
    .map((part) => part.text ?? "")
    .join("");

  return text || outputText || "";
}

function parseResponsesOutput(
  output: ResponsesOutputItem[] | undefined,
  outputText?: string,
): { text: string; toolCalls: ToolCallEntry[] } {
  const text = extractResponsesText(output, outputText);

  const toolCalls = (output ?? [])
    .filter((item) => item.type === "function_call" && "name" in item && item.name)
    .map((item) => ({
      id: ("call_id" in item && item.call_id) ? item.call_id : `resp_${Math.random().toString(36).slice(2, 9)}`,
      name: ("name" in item && item.name) ? item.name : "unknown_function",
      arguments: ("arguments" in item && item.arguments)
        ? JSON.parse(item.arguments) as Record<string, unknown>
        : {},
    }));

  // Debug: log when output items exist but no tool calls matched
  if (output && output.length > 0 && toolCalls.length === 0 && !text) {
    const itemTypes = output.map(i => i.type).join(", ");
    console.warn(`[responses-adapter] Output has ${output.length} items [${itemTypes}] but 0 tool calls and empty text.`);
  }

  return { text, toolCalls };
}

async function readResponsesPayload(
  res: Response,
  providerId: string,
  baseUrl: string,
): Promise<{
  output?: ResponsesOutputItem[];
  output_text?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}> {
  if (!isChatGptBackend(providerId, baseUrl)) {
    return await res.json() as {
      output?: ResponsesOutputItem[];
      output_text?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
  }

  const rawText = await res.text();
  const lines = rawText.split("\n");
  let lastCompleted: Record<string, unknown> | null = null;
  let lastDelta = "";
  // Collect function call argument deltas keyed by output_index
  const funcCallDeltas = new Map<string, { callId: string; name: string; args: string }>();

  for (const line of lines) {
    if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
    try {
      const parsed = JSON.parse(line.slice(6)) as Record<string, unknown>;
      if (parsed.type === "response.completed" && parsed.response) {
        lastCompleted = parsed.response as Record<string, unknown>;
      }
      if (parsed.type === "response.output_text.delta" && typeof parsed.delta === "string") {
        lastDelta += parsed.delta;
      }
      // Capture function call events from the SSE stream
      if (parsed.type === "response.output_item.added") {
        const item = parsed.item as Record<string, unknown> | undefined;
        if (item?.type === "function_call" && item.name) {
          const idx = String(parsed.output_index ?? "0");
          funcCallDeltas.set(idx, { callId: String(item.call_id ?? ""), name: String(item.name), args: "" });
        }
      }
      if (parsed.type === "response.function_call_arguments.delta" && typeof parsed.delta === "string") {
        const idx = String(parsed.output_index ?? "0");
        const existing = funcCallDeltas.get(idx);
        if (existing) existing.args += parsed.delta;
      }
    } catch {
      // Ignore malformed SSE lines and keep scanning for the completed payload.
    }
  }

  // Log what we got for diagnostics
  const eventTypes = lines
    .filter(l => l.startsWith("data: ") && l !== "data: [DONE]")
    .map(l => { try { return (JSON.parse(l.slice(6)) as Record<string, unknown>).type; } catch { return "parse_error"; } });
  const uniqueTypes = [...new Set(eventTypes)];
  if (!lastCompleted && !lastDelta && funcCallDeltas.size === 0) {
    console.warn(
      `[responses-adapter] Empty response from ${providerId}. ` +
      `SSE lines: ${lines.length}, event types: [${uniqueTypes.join(", ")}]. ` +
      `First 500 chars: ${rawText.slice(0, 500)}`,
    );
  }

  // Build synthetic output from collected SSE deltas (text + function calls).
  const syntheticOutput: ResponsesOutputItem[] = [];
  for (const [, fc] of funcCallDeltas) {
    syntheticOutput.push({
      type: "function_call",
      call_id: fc.callId,
      name: fc.name,
      arguments: fc.args,
    } as unknown as ResponsesOutputItem);
  }
  if (lastDelta) {
    syntheticOutput.push({
      type: "message",
      content: [{ type: "output_text", text: lastDelta }],
    } as unknown as ResponsesOutputItem);
  }

  // If response.completed exists, use it for usage data — but prefer
  // synthetic output when the completed event has an empty output array.
  // The ChatGPT backend often sends text/tools via SSE deltas while the
  // completed event's output[] is empty.
  if (lastCompleted) {
    const completedOutput = (lastCompleted as { output?: unknown[] }).output ?? [];
    const useCompleted = completedOutput.length > 0;
    return {
      output: useCompleted ? completedOutput : syntheticOutput,
      output_text: useCompleted ? (lastCompleted as { output_text?: string }).output_text : (lastDelta || undefined),
      usage: (lastCompleted as { usage?: { input_tokens?: number; output_tokens?: number } }).usage,
    } as {
      output?: ResponsesOutputItem[];
      output_text?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
  }

  // No completed event — return synthetic output only
  if (syntheticOutput.length === 0) {
    syntheticOutput.push({
      type: "message",
      content: [{ type: "output_text", text: "" }],
    } as unknown as ResponsesOutputItem);
  }

  return {
    output: syntheticOutput,
    output_text: lastDelta || undefined,
  } as {
    output?: ResponsesOutputItem[];
    output_text?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
}

export const responsesAdapter: ExecutionAdapterHandler = {
  type: "responses",

  async execute(request: AdapterRequest): Promise<AdapterResult> {
    const { providerId, modelId, plan, provider, messages, systemPrompt, tools, previousResponseId } = request;
    const responsesUrl = buildResponsesUrl(providerId, provider.baseUrl);

    // When chaining with previous_response_id, only send new messages (the last
    // user message + any tool results), not the full history. The server has the
    // rest. When no previousResponseId, send the full conversation.
    const inputMessages = previousResponseId
      ? messages.slice(-1)  // just the latest message
      : messages;

    const body: Record<string, unknown> = {
      model: modelId,
      input: inputMessages.flatMap((message) => formatMessageForResponses(message)),
      store: true,  // required for previous_response_id chaining
    };

    if (previousResponseId) {
      body.previous_response_id = previousResponseId;
    }

    if (isChatGptBackend(providerId, provider.baseUrl)) {
      body.stream = true;
    }

    if (systemPrompt) {
      body.instructions = systemPrompt;
    }
    if (plan.maxTokens && !isChatGptBackend(providerId, provider.baseUrl)) {
      body.max_output_tokens = plan.maxTokens;
    }
    if (plan.temperature !== undefined) {
      body.temperature = plan.temperature;
    }
    // EP-INF-013: explicit reasoning_effort takes precedence; fall back to effort.
    // Codex models (gpt-5.3-codex, gpt-5.4 via ChatGPT backend) require reasoning
    // enabled to produce any output. Default to "low" when no effort is specified.
    if (typeof plan.providerSettings?.reasoning_effort === "string") {
      body.reasoning = { effort: plan.providerSettings.reasoning_effort };
    } else if (typeof plan.providerSettings?.effort === "string" && plan.providerSettings.effort !== "low") {
      const effortMap: Record<string, string> = { medium: "medium", high: "high", max: "high" };
      const mapped = effortMap[plan.providerSettings.effort];
      if (mapped) body.reasoning = { effort: mapped };
    }
    // Ensure reasoning is always set for the Responses API — models like
    // gpt-5.3-codex return empty output when reasoning.effort is "none".
    if (!body.reasoning) {
      body.reasoning = { effort: "low" };
    }
    const responseTools = toResponsesTools(tools);
    if (responseTools) {
      body.tools = responseTools;
    }

    // Debug: log the request for ChatGPT backend to diagnose empty tool responses
    if (isChatGptBackend(providerId, provider.baseUrl)) {
      const toolCount = (body.tools as unknown[] | undefined)?.length ?? 0;
      const toolNames = (body.tools as Array<Record<string, unknown>> | undefined)?.map(t => t.name).slice(0, 5).join(", ") ?? "none";
      const inputPreview = JSON.stringify(body.input).slice(0, 300);
      console.log(
        `[responses-adapter] REQUEST to ${responsesUrl} | model=${body.model} | ` +
        `tools=${toolCount} [${toolNames}] | stream=${body.stream} | ` +
        `input=${inputPreview}`,
      );
    }

    const startMs = Date.now();
    let res: Response;
    try {
      res = await fetch(responsesUrl, {
        method: "POST",
        headers: provider.headers,
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

    const data = await readResponsesPayload(res, providerId, provider.baseUrl);
    const parsed = parseResponsesOutput(data.output, data.output_text);

    // Always log for chatgpt backend until the tool issue is resolved
    if (isChatGptBackend(providerId, provider.baseUrl)) {
      if (!parsed.text && parsed.toolCalls.length === 0) {
        const diagnostic =
          `output items: ${data.output?.length ?? "null"}, ` +
          `output types: [${(data.output ?? []).map(i => i.type).join(", ")}], ` +
          `raw: ${JSON.stringify(data).slice(0, 1000)}`;
        console.warn(`[responses-adapter] EMPTY RESPONSE from ${providerId}/${modelId}. ${diagnostic}`);

        // Surface diagnostic in the text so the agentic loop can show it to the user
        return {
          text: `[DEBUG] Empty response from ${responsesUrl} (model: ${modelId}). ${diagnostic}`,
          toolCalls: [],
          usage: {
            inputTokens: data.usage?.input_tokens ?? 0,
            outputTokens: data.usage?.output_tokens ?? 0,
          },
          inferenceMs,
          raw: data as Record<string, unknown>,
          responseId: (data as { id?: string }).id ?? undefined,
        };
      } else {
        console.log(
          `[responses-adapter] OK from ${providerId}/${modelId}: ` +
          `text=${parsed.text.length} chars, tools=${parsed.toolCalls.length} [${parsed.toolCalls.map(t => t.name).join(", ")}]`,
        );
      }
    }

    return {
      text: parsed.text,
      toolCalls: parsed.toolCalls,
      usage: {
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
      },
      inferenceMs,
      raw: data as Record<string, unknown>,
      responseId: (data as { id?: string }).id ?? undefined,
    };
  },
};

registerExecutionAdapter(responsesAdapter);
