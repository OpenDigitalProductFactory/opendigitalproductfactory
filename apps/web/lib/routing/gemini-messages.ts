import type { ChatMessage } from "../ai-inference";
import type { ToolCallEntry } from "./adapter-types";

type GeminiContent = { role: "user" | "model"; parts: Record<string, unknown>[] };

function responseObject(content: ChatMessage["content"]): Record<string, unknown> {
  let value: unknown = content;
  if (typeof content === "string") {
    try { value = JSON.parse(content); } catch { /* Plain tool output stays text. */ }
  }
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : { output: value };
}

/** Translate screened messages, retaining call/result pairing and native signatures. */
export function formatMessagesForGemini(messages: readonly ChatMessage[], modelId: string): GeminiContent[] {
  const contents: GeminiContent[] = [];
  const calls = new Map<string, ToolCallEntry>();
  for (const message of messages) {
    if (message.role === "tool") {
      const call = message.toolCallId ? calls.get(message.toolCallId) : undefined;
      if (!call) throw new Error("Gemini tool result has no preceding correlated call");
      const native = call.gemini?.modelId === modelId ? call.gemini : undefined;
      const part = { functionResponse: {
        ...(native?.functionCallId ? { id: native.functionCallId } : {}),
        name: call.name, response: responseObject(message.content),
      } };
      const previous = contents.at(-1);
      if (previous?.role === "user" && previous.parts.every((p) => "functionResponse" in p)) previous.parts.push(part);
      else contents.push({ role: "user", parts: [part] });
      continue;
    }
    const parts: Record<string, unknown>[] = [];
    const text = typeof message.content === "string" ? message.content : JSON.stringify(message.content);
    if (text) parts.push({ text });
    for (const call of message.toolCalls ?? []) {
      calls.set(call.id, call);
      const native = call.gemini?.modelId === modelId ? call.gemini : undefined;
      // Google's documented history-transfer marker is only for foreign/legacy
      // calls, never a substitute for a signature omitted by a native response.
      // https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures#faqs
      const signature = native?.thoughtSignature ?? (!native ? "context_engineering_is_the_way_to_go" : undefined);
      parts.push({ functionCall: {
        ...(native?.functionCallId ? { id: native.functionCallId } : {}),
        name: call.name, args: call.arguments,
      }, ...(signature ? { thoughtSignature: signature } : {}) });
    }
    if (parts.length) contents.push({ role: message.role === "assistant" ? "model" : "user", parts });
  }
  return contents;
}
