import type { AdapterRequest, AdapterResult, ExecutionAdapterHandler } from "./adapter-types";
import type { ChatMessage } from "./chat-message-types";
import { extractAnthropicToolCalls, formatMessageForAnthropic } from "./provider-message-format";
import { toWireSampling } from "./sampling-profile";
import {
  assertReassessmentActive, assertReassessmentPlan, currentFiniteReassessmentExecution, reassessmentCaptureValue,
  refuseReassessmentExecution, validateReassessmentToolCalls, withReassessmentTokenReservation,
} from "./reassessment-execution-scope";

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const tokenCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const refuse = (code: string): never => refuseReassessmentExecution(`reassessment-native-messages-${code}`);
const onlyKeys = (value: object, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));
// A turn owns its complete count/body/reservation handoff. A later semantic
// continuation may acquire this again, but overlapping dispatch cannot race it.
const dispatching = new WeakSet<object>();

function messageForWire(message: ChatMessage): Record<string, unknown> {
  if (!onlyKeys(message, ["role", "content", "toolCalls", "toolCallId"]) || !["user", "assistant", "tool"].includes(message.role)) {
    return refuse("message-unsupported");
  }
  reassessmentCaptureValue(message);
  if (message.role === "tool") {
    if (!nonempty(message.toolCallId) || typeof message.content !== "string" || message.toolCalls !== undefined) return refuse("tool-result-unsupported");
    return formatMessageForAnthropic(message);
  }
  if (message.toolCallId !== undefined || (message.toolCalls !== undefined && message.role !== "assistant")) return refuse("message-unsupported");
  if (message.toolCalls !== undefined) {
    if (!Array.isArray(message.toolCalls) || message.toolCalls.some(call => !object(call)
      || !onlyKeys(call, ["id", "name", "arguments"]) || !nonempty(call.id) || !nonempty(call.name) || !object(call.arguments))) {
      return refuse("tool-history-invalid");
    }
    validateReassessmentToolCalls(message.toolCalls);
  }
  if (typeof message.content === "string") return formatMessageForAnthropic(message);
  if (!Array.isArray(message.content)) return refuse("message-unsupported");
  for (const block of message.content) {
    if (!object(block)) return refuse("content-unsupported");
    if (block.type === "text" && onlyKeys(block, ["type", "text"]) && typeof block.text === "string") continue;
    if (block.type === "tool_use" && message.role === "assistant" && message.toolCalls === undefined
      && onlyKeys(block, ["type", "id", "name", "input"]) && nonempty(block.id) && nonempty(block.name) && object(block.input)) {
      validateReassessmentToolCalls([{ name: block.name, arguments: block.input }]); continue;
    }
    if (block.type === "tool_result" && message.role === "user" && onlyKeys(block, ["type", "tool_use_id", "content"])
      && nonempty(block.tool_use_id) && typeof block.content === "string") continue;
    return refuse("content-unsupported");
  }
  if (message.toolCalls !== undefined) {
    return formatMessageForAnthropic({ ...message, content: message.content.map(block => block.type === "text" ? block.text : "").join("") });
  }
  // The shared formatter handles text arrays; native tool blocks must retain
  // their structured form rather than become a JSON string in that formatter.
  return { ...formatMessageForAnthropic(message), content: message.content };
}

function toolsForWire(tools: NonNullable<AdapterRequest["tools"]>) {
  return tools.map(tool => {
    const fn = tool.function;
    if (tool.type !== "function" || !onlyKeys(tool, ["type", "function"]) || !object(fn)
      || !onlyKeys(fn, ["name", "description", "parameters"]) || !nonempty(fn.name) || !object(fn.parameters)
      || (fn.description !== undefined && typeof fn.description !== "string")) return refuse("tool-definition-unsupported");
    return { name: fn.name, ...(fn.description !== undefined ? { description: fn.description } : {}), input_schema: fn.parameters };
  });
}

function samplingForWire(plan: AdapterRequest["plan"]): Record<string, number> {
  const sampling = plan.sampling;
  if (sampling && (!object(sampling.values) || !onlyKeys(sampling, ["values", "provenance", "mode", "dropped"])
    || !onlyKeys(sampling.values, ["temperature", "topP", "topK"])
    || Object.values(sampling.values).some(value => typeof value !== "number" || !Number.isFinite(value)))) return refuse("sampling-unsupported");
  const wire = sampling ? toWireSampling({ ...sampling, dropped: sampling.dropped ?? [] }) : {};
  if (plan.temperature !== undefined) {
    if (!Number.isFinite(plan.temperature) || wire.temperature !== undefined && wire.temperature !== plan.temperature) return refuse("sampling-conflict");
    wire.temperature = plan.temperature;
  }
  if (wire.temperature !== undefined && wire.temperature < 0
    || wire.top_p !== undefined && (wire.top_p < 0 || wire.top_p > 1)
    || wire.top_k !== undefined && !tokenCount(wire.top_k)) return refuse("sampling-invalid");
  return wire;
}

async function responseJson(response: Response, operation: "count" | "generation"): Promise<Record<string, unknown>> {
  if (!response.ok) return refuse(`${operation}-failed`);
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await response.arrayBuffer())); }
  catch { return refuse(`${operation}-invalid-json`); }
  if (!object(value)) return refuse(`${operation}-invalid-response`);
  return value;
}

function normalizeGeneration(raw: Record<string, unknown>, inputTokens: number, maximumOutput: number, inferenceMs: number): AdapterResult {
  const usage = raw.usage;
  if (!object(usage) || !tokenCount(usage.input_tokens) || !tokenCount(usage.cache_read_input_tokens)
    || !tokenCount(usage.output_tokens) || usage.output_tokens > maximumOutput
    || !Number.isSafeInteger(usage.input_tokens + usage.cache_read_input_tokens)
    || usage.input_tokens + usage.cache_read_input_tokens !== inputTokens
    || (usage.cache_creation_input_tokens !== undefined && usage.cache_creation_input_tokens !== 0)) return refuse("usage-unproven");
  if (!Array.isArray(raw.content) || !nonempty(raw.stop_reason)) return refuse("generation-incomplete");
  const text: string[] = [], reasoning: string[] = [];
  for (const block of raw.content) {
    if (!object(block)) return refuse("generation-content-invalid");
    if (block.type === "text" && typeof block.text === "string") text.push(block.text);
    else if (block.type === "thinking" && typeof block.thinking === "string") reasoning.push(block.thinking);
    else if (block.type === "tool_use" && nonempty(block.id) && nonempty(block.name) && object(block.input)) continue;
    else return refuse("generation-content-unsupported");
  }
  const toolCalls = extractAnthropicToolCalls(raw.content);
  validateReassessmentToolCalls(toolCalls);
  return { text: text.join(""), toolCalls, ...(reasoning.length ? { reasoning: reasoning.join("") } : {}),
    usage: { inputTokens, outputTokens: usage.output_tokens, cacheReadInputTokens: usage.cache_read_input_tokens },
    inferenceMs, raw, finishReason: raw.stop_reason, truncated: raw.stop_reason === "max_tokens" };
}

/** Concrete finite wire. Only a server-promoted execution with the audited
 * model/template/config proof may select this private handler. */
export const reassessmentMessagesAdapter: ExecutionAdapterHandler = {
  type: "restricted-native-messages",
  async execute(request) {
    const scope = assertReassessmentPlan(request);
    const proof = scope?.qualification.finiteTokenProof;
    if (!scope || scope !== currentFiniteReassessmentExecution() || proof?.kind !== "dmr-native-messages-v1") return refuse("promoted-qualified-scope-required");
    if (dispatching.has(scope)) return refuse("concurrent-dispatch");
    dispatching.add(scope);
    try {
    const { plan } = request;
    const evidence = plan.localThinkingBudgetEvidence;
    if (evidence && (evidence.dialect !== "llama.cpp-b9879" || evidence.modelDigest !== proof.modelDigest
      || evidence.engineIdentity !== proof.engineIdentity || evidence.templateDigest !== proof.templateDigest || evidence.configDigest !== proof.configDigest)) return refuse("runtime-evidence-changed");
    if (Object.keys(plan.providerSettings).length
      || plan.localThinkingBudgetRequest !== undefined || request.previousResponseId !== undefined
      || plan.openRouterPolicy !== undefined || plan.openRouterObligations !== undefined
      || !onlyKeys(plan.toolPolicy, ["toolChoice", "allowParallelToolCalls"])
      || !onlyKeys(plan.responsePolicy, ["stream", "strictSchema", "terminalWriterToolName"])
      || plan.toolPolicy.allowParallelToolCalls !== undefined
      || plan.toolPolicy.toolChoice !== undefined && !["auto", "required"].includes(plan.toolPolicy.toolChoice)
      || plan.responsePolicy.stream !== undefined && plan.responsePolicy.stream !== false
      || plan.responsePolicy.strictSchema !== undefined && plan.responsePolicy.strictSchema !== false) return refuse("settings-unsupported");
    if (typeof request.systemPrompt !== "string" || !Array.isArray(request.messages)) return refuse("message-unsupported");
    const body = { model: proof.modelDigest, system: request.systemPrompt, messages: request.messages.map(messageForWire),
      tools: toolsForWire(request.tools!), tool_choice: { type: plan.toolPolicy.toolChoice === "required" ? "any" : "auto" },
      max_tokens: scope.qualification.bounds.maxOutputTokens, stream: false, ...samplingForWire(plan) };
    const bodyUtf8 = JSON.stringify(body);
    const headers = { ...request.provider.headers, "Content-Type": "application/json" };
    const root = proof.apiRoot.replace(/\/+$/, "");
    const url = `${root}/engines/llama.cpp/v1/messages`;
    const startedAt = Date.now();
    const count = await responseJson(await request.fetchImpl(`${url}/count_tokens`, {
      method: "POST", headers, body: bodyUtf8, redirect: "error",
    }), "count");
    if (!tokenCount(count.input_tokens)) return refuse("count-unproven");
    const inputTokens = count.input_tokens;
    const response = await withReassessmentTokenReservation({ bodyUtf8, inputTokens,
      maxOutputTokens: scope.qualification.bounds.maxOutputTokens }, () => request.fetchImpl(url, {
      method: "POST", headers, body: bodyUtf8, redirect: "error",
    }));
    assertReassessmentActive();
    return normalizeGeneration(await responseJson(response, "generation"), inputTokens,
      scope.qualification.bounds.maxOutputTokens, Date.now() - startedAt);
    } finally { dispatching.delete(scope); }
  },
};
