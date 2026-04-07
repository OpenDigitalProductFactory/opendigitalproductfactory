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
    } catch {
      // Ignore malformed SSE lines and keep scanning for the completed payload.
    }
  }

  return (lastCompleted ?? {
    output: [{ type: "message", content: [{ type: "output_text", text: lastDelta }] }],
  }) as {
    output?: ResponsesOutputItem[];
    output_text?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
}

export const responsesAdapter: ExecutionAdapterHandler = {
  type: "responses",

  async execute(request: AdapterRequest): Promise<AdapterResult> {
    const { providerId, modelId, plan, provider, messages, systemPrompt, tools } = request;
    const responsesUrl = buildResponsesUrl(providerId, provider.baseUrl);

    const body: Record<string, unknown> = {
      model: modelId,
      input: messages.flatMap((message) => formatMessageForResponses(message)),
      store: false,
    };

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
    if (typeof plan.providerSettings?.reasoning_effort === "string") {
      body.reasoning = { effort: plan.providerSettings.reasoning_effort };
    } else if (typeof plan.providerSettings?.effort === "string" && plan.providerSettings.effort !== "low") {
      const effortMap: Record<string, string> = { medium: "medium", high: "high", max: "high" };
      const mapped = effortMap[plan.providerSettings.effort];
      if (mapped) body.reasoning = { effort: mapped };
    }
    const responseTools = toResponsesTools(tools);
    if (responseTools) {
      body.tools = responseTools;
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

    return {
      text: parsed.text,
      toolCalls: parsed.toolCalls,
      usage: {
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
      },
      inferenceMs,
      raw: data as Record<string, unknown>,
    };
  },
};

registerExecutionAdapter(responsesAdapter);
