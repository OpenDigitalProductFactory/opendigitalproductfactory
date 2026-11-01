/**
 * Responses-backed execution adapter for OpenAI Codex and ChatGPT subscription
 * providers.
 */

import type { ToolCallEntry } from "./chat-message-types";
import type { AdapterRequest, AdapterResult, ExecutionAdapterHandler } from "./adapter-types";
import { InferenceError, classifyHttpError } from "./inference-error";
import { formatMessageForResponses } from "./provider-message-format";
import { registerExecutionAdapter } from "./execution-adapter-registry";
import { buildResponsesUrl, isChatGptBackend } from "./responses-contract";
import { isReassessmentExecutionError } from "./reassessment-execution-scope";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";

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

type ResponsesPayload = {
  id?: string;
  status?: string;
  incomplete_details?: { reason?: string };
  output?: ResponsesOutputItem[];
  output_text?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
};

/** The parameter a 400 names as unsupported, e.g. {"detail":"Unsupported parameter: temperature"}. */
export function unsupportedParameterName(status: number, errBody: string): string | null {
  if (status !== 400) return null;
  const match = /unsupported parameter:?\s*['"`]?([A-Za-z_][A-Za-z0-9_.]*)/i.exec(errBody);
  return match ? match[1]! : null;
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
): Promise<{ data: ResponsesPayload; terminalEvidenceValid: boolean }> {
  if (!isChatGptBackend(providerId, baseUrl)) {
    return { data: await res.json() as ResponsesPayload, terminalEvidenceValid: true };
  }

  const rawText = await res.text();
  const lines = rawText.split("\n");
  let lastTerminal: Record<string, unknown> | null = null;
  let lastDelta = "";
  let terminalEvidenceValid = true;
  let terminalFingerprint: string | undefined;
  let responseId: string | undefined;
  let declaredEvent: string | undefined;
  // Collect function call argument deltas keyed by output_index
  const funcCallDeltas = new Map<string, { callId: string; name: string; args: string }>();

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line) { declaredEvent = undefined; continue; }
    if (line.startsWith("event:")) { declaredEvent = line.slice(6).trim(); continue; }
    if (!line.startsWith("data:")) continue;
    const eventData = line.slice(5).trimStart();
    if (!eventData || eventData === "[DONE]") continue;
    try {
      const parsed = JSON.parse(eventData) as Record<string, unknown>;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) { terminalEvidenceValid = false; continue; }
      if (declaredEvent && declaredEvent !== parsed.type) terminalEvidenceValid = false;
      const response = parsed.response && typeof parsed.response === "object" && !Array.isArray(parsed.response)
        ? parsed.response as Record<string, unknown> : undefined;
      const eventResponseId = response?.id ?? parsed.response_id;
      if (typeof eventResponseId === "string" && eventResponseId) {
        if (responseId && responseId !== eventResponseId) terminalEvidenceValid = false;
        responseId ??= eventResponseId;
      }
      const terminalEvent = ["response.completed", "response.incomplete", "response.failed"].includes(String(parsed.type));
      if (lastTerminal && !terminalEvent && String(parsed.type).endsWith(".delta")) terminalEvidenceValid = false;
      if (terminalEvent) {
        if (!response) { terminalEvidenceValid = false; continue; }
        const status = String(parsed.type).slice("response.".length);
        if (response.status !== undefined && response.status !== status) terminalEvidenceValid = false;
        const terminal = { ...response, status: response.status ?? status };
        const fingerprint = canonicalJson(terminal);
        if (terminalFingerprint && terminalFingerprint !== fingerprint) terminalEvidenceValid = false;
        terminalFingerprint ??= fingerprint;
        lastTerminal = terminal;
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
      // Retain readable output, but malformed protocol data cannot prove completion.
      terminalEvidenceValid = false;
    }
  }

  // Log what we got for diagnostics
  const eventTypes = lines
    .filter(l => l.startsWith("data: ") && l !== "data: [DONE]")
    .map(l => { try { return (JSON.parse(l.slice(6)) as Record<string, unknown>).type; } catch { return "parse_error"; } });
  const uniqueTypes = [...new Set(eventTypes)];
  if (!lastTerminal && !lastDelta && funcCallDeltas.size === 0) {
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

  // Preserve the actual terminal payload and its usage; prefer
  // synthetic output when the completed event has empty/useless output.
  // The ChatGPT backend often sends text/tools via SSE deltas while the
  // completed event's output[] is empty or contains only empty text.
  if (lastTerminal) {
    const completedOutput = (lastTerminal as { output?: unknown[] }).output ?? [];
    // Check if completed output has actual content (non-empty text or tool calls)
    const hasRealContent = completedOutput.some((item: unknown) => {
      const it = item as Record<string, unknown>;
      if (it.type === "function_call" && it.name) return true;
      if (it.type === "message") {
        const content = (it.content as Array<{ text?: string }>) ?? [];
        return content.some(c => c.text && c.text.length > 0);
      }
      return false;
    });
    const useCompleted = hasRealContent;
    return { terminalEvidenceValid, data: {
      ...lastTerminal,
      output: useCompleted ? completedOutput : syntheticOutput,
      output_text: useCompleted ? (lastTerminal as { output_text?: string }).output_text : (lastDelta || undefined),
      usage: (lastTerminal as ResponsesPayload).usage,
    } as ResponsesPayload };
  }

  // No completed event — return synthetic output only
  if (syntheticOutput.length === 0) {
    syntheticOutput.push({
      type: "message",
      content: [{ type: "output_text", text: "" }],
    } as unknown as ResponsesOutputItem);
  }

  return { terminalEvidenceValid: false, data: {
    output: syntheticOutput,
    output_text: lastDelta || undefined,
  } as ResponsesPayload };
}

export const responsesAdapter: ExecutionAdapterHandler = {
  type: "responses",

  async execute(request: AdapterRequest): Promise<AdapterResult> {
    const { providerId, modelId, plan, provider, messages, systemPrompt, tools, previousResponseId } = request;
    const requiredOutputBound = plan.responsePolicy.requireOutputBound === true;
    if (requiredOutputBound && (!Number.isSafeInteger(plan.maxTokens) || (plan.maxTokens ?? 0) <= 0)) {
      throw new InferenceError("Required output bound must be a positive finite integer", "provider_error", providerId);
    }
    const responsesUrl = buildResponsesUrl(providerId, provider.baseUrl);

    const body: Record<string, unknown> = {
      model: modelId,
      input: messages.flatMap((message) => formatMessageForResponses(message)),
      store: false,
    };

    // Responses API conversation chaining: when we have a previous response ID
    // from an earlier iteration in the same agentic loop, chain to it.
    // The ChatGPT backend supports this for within-session continuity.
    if (previousResponseId) {
      body.previous_response_id = previousResponseId;
      body.store = true;  // chaining requires stored responses
    }

    if (isChatGptBackend(providerId, provider.baseUrl)) {
      body.stream = true;
    }

    if (systemPrompt) {
      body.instructions = systemPrompt;
    }
    if (plan.maxTokens && (requiredOutputBound || !isChatGptBackend(providerId, provider.baseUrl))) {
      body.max_output_tokens = plan.maxTokens;
    }
    // BI-EFA3869E: the Codex backend's reasoning models reject `temperature`
    // ("Unsupported parameter: temperature", HTTP 400) — every model the
    // ChatGPT subscription lists. Sampling is steered by reasoning.effort there.
    if (plan.temperature !== undefined && !isChatGptBackend(providerId, provider.baseUrl)) {
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
      if (plan.toolPolicy.toolChoice) body.tool_choice = plan.toolPolicy.toolChoice;
    }

    // Log all Responses API requests to help diagnose tool call issues
    {
      const toolCount = (body.tools as unknown[] | undefined)?.length ?? 0;
      const toolNames = (body.tools as Array<Record<string, unknown>> | undefined)?.map(t => t.name).slice(0, 5).join(", ") ?? "none";
      const inputPreview = JSON.stringify(body.input).slice(0, 200);
      console.log(
        `[responses-adapter] REQUEST to ${responsesUrl} | model=${body.model} | ` +
        `tools=${toolCount} [${toolNames}] | stream=${body.stream ?? false} | ` +
        `reasoning=${JSON.stringify(body.reasoning)} | input=${inputPreview}`,
      );
    }

    const startMs = Date.now();
    let res: Response;
    // Retry only the existing optional sampling setting. Required tools,
    // instructions, state, storage and output bounds must survive unchanged.
    for (let attempt = 0; ; attempt += 1) {
      try {
        res = await request.fetchImpl(responsesUrl, {
          method: "POST",
          headers: provider.headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(180_000),
        });
      } catch (e) {
        if (isReassessmentExecutionError(e)) throw e;
        throw new InferenceError(
          `Network error calling ${providerId}: ${e instanceof Error ? e.message : String(e)}`,
          "network",
          providerId,
        );
      }
      if (res.ok) break;
      const errBody = await res.text().catch(() => "");
      const unsupported = unsupportedParameterName(res.status, errBody);
      if (attempt === 0 && unsupported === "temperature" && unsupported in body) {
        console.warn(`[responses-adapter] ${providerId} rejected parameter "${unsupported}" — retrying once without it.`);
        delete body[unsupported];
        continue;
      }
      throw classifyHttpError(res.status, providerId, errBody, res.headers);
    }
    const inferenceMs = Date.now() - startMs;

    const { data, terminalEvidenceValid } = await readResponsesPayload(res, providerId, provider.baseUrl);
    const parsed = parseResponsesOutput(data.output, data.output_text);
    const status = typeof data.status === "string" ? data.status : undefined;
    const incompleteReason = typeof data.incomplete_details?.reason === "string" ? data.incomplete_details.reason : undefined;
    const contradictoryCompletion = status === "completed" && (data.incomplete_details != null
      || (data as Record<string, unknown>).error != null);
    const termination = terminalEvidenceValid && !contradictoryCompletion && status ? { finishReason: status === "incomplete" ? incompleteReason ?? status : status,
      truncated: status === "incomplete" && incompleteReason === "max_output_tokens" } : {};

    // Log all responses to diagnose tool call issues
    if (!parsed.text && parsed.toolCalls.length === 0) {
      const diagnostic =
        `output items: ${data.output?.length ?? "null"}, ` +
        `output types: [${(data.output ?? []).map(i => i.type).join(", ")}], ` +
        `raw: ${JSON.stringify(data).slice(0, 1000)}`;
      console.warn(`[responses-adapter] EMPTY RESPONSE from ${providerId}/${modelId}. ${diagnostic}`);

      if (isChatGptBackend(providerId, provider.baseUrl)) {
        // Surface diagnostic in text for chatgpt backend (harder to debug)
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
          ...termination,
        };
      }
    } else {
      console.log(
        `[responses-adapter] OK from ${providerId}/${modelId}: ` +
        `text=${parsed.text.length} chars, tools=${parsed.toolCalls.length} [${parsed.toolCalls.map(t => t.name).join(", ")}]`,
      );
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
      ...termination,
    };
  },
};

registerExecutionAdapter(responsesAdapter);
