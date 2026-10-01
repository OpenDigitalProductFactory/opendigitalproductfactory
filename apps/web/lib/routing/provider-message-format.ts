// apps/web/lib/routing/provider-message-format.ts
// Pure wire-format helpers shared by callProvider and the execution adapters:
// tool-call extraction from provider responses and ChatMessage formatting for
// the Anthropic, OpenAI Chat Completions and Responses APIs. A leaf in routing,
// so the adapters need not import inference/ai-inference.ts (which imports
// them for registration). ai-inference.ts re-exports every public name.

import type { ChatMessage, ContentBlock } from "./chat-message-types";

/** True when content carries only text/image blocks — the subset both the OpenAI
 *  AND Anthropic formatters can pass through (Anthropic has no audio block). */
function isMultimodalInputContent(content: ContentBlock[]): boolean {
  return content.length > 0 && content.every((b) => b.type === "text" || b.type === "image_url");
}

/** True when content carries only model-facing input blocks the OpenAI Chat
 *  Completions API accepts natively (text / image / audio). Superset of the
 *  Anthropic predicate — used only by the OpenAI formatter passthrough. */
function isOpenAIInputContent(content: ContentBlock[]): boolean {
  return (
    content.length > 0 &&
    content.every((b) => b.type === "text" || b.type === "image_url" || b.type === "input_audio")
  );
}

/** Convert an OpenAI-style image_url (data: URL) to an Anthropic image source block. */
function imageUrlToAnthropicBlock(url: string): Record<string, unknown> {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(url);
  if (m) {
    return { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } };
  }
  // Anthropic also accepts URL image sources.
  return { type: "image", source: { type: "url", url } };
}

// ─── Tool Call Extraction Helpers ─────────────────────────────────────────────

/** Extract tool calls from Anthropic content blocks, preserving IDs */
export function extractAnthropicToolCalls(
  contentBlocks: Array<{ type?: string; id?: string; name?: string; input?: Record<string, unknown> }>,
): Array<{ id: string; name: string; arguments: Record<string, unknown> }> {
  return contentBlocks
    .filter((b) => b.type === "tool_use" && b.name)
    .map((b) => ({
      id: b.id ?? `synth_${Math.random().toString(36).slice(2, 9)}`,
      name: b.name!,
      arguments: b.input ?? {},
    }));
}

/** Extract tool calls from OpenAI-compatible tool_calls array, preserving IDs */
export function extractOpenAIToolCalls(
  rawToolCalls: Array<{ id?: string; function?: { name?: string; arguments?: string } }>,
): Array<{ id: string; name: string; arguments: Record<string, unknown> }> {
  return rawToolCalls
    .filter((tc) => tc.function?.name)
    .map((tc) => ({
      id: tc.id ?? `synth_${Math.random().toString(36).slice(2, 9)}`,
      name: tc.function!.name!,
      arguments: tc.function?.arguments ? JSON.parse(tc.function.arguments) as Record<string, unknown> : {},
    }));
}

/**
 * Extract tool calls embedded as text when the model runner doesn't translate
 * them to structured `tool_calls`. Handles two formats:
 *
 * 1. Standard Gemma/Llama JSON:  <tool_call>{"name":"fn","arguments":{...}}</tool_call>
 * 2. Gemma template variant:     <|tool_call>call: fn{key: "value"}<tool_call|>
 *
 * Returns { toolCalls, cleanText } where cleanText has the markers stripped.
 */
export function extractTextualToolCalls(
  text: string,
): { toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>; cleanText: string } {
  const toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
  let cleanText = text;

  // Format 1: <tool_call>{"name":"fn","arguments":{...}}</tool_call>
  const jsonPattern = /<tool_call>([\s\S]*?)<\/tool_call>/g;
  cleanText = cleanText.replace(jsonPattern, (_, inner) => {
    try {
      const parsed = JSON.parse(inner.trim()) as { name?: string; arguments?: Record<string, unknown> };
      if (parsed.name) {
        toolCalls.push({
          id: `text_${Math.random().toString(36).slice(2, 9)}`,
          name: parsed.name,
          arguments: parsed.arguments ?? {},
        });
      }
    } catch {
      // malformed — skip
    }
    return "";
  });

  // Format 2: <|tool_call>call: fn{key: "value", ...}<tool_call|>
  // Also covers <|tool_call>fn({"key":"value"})<tool_call|> variants.
  const templatePattern = /<\|tool_call\>(?:call:\s*)?(\w+)\s*[\({]([\s\S]*?)[\)}]?\s*<tool_call\|>/g;
  cleanText = cleanText.replace(templatePattern, (_, name: string, argsRaw: string) => {
    try {
      // argsRaw may be JS-like object literal — attempt JSON parse after key-quoting
      const jsonified = argsRaw
        .trim()
        // Add quotes around unquoted keys: word: → "word":
        .replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":')
        // Ensure leading brace
        .replace(/^([^{])/, '{$1')
        .replace(/([^}])$/, '$1}');
      const args = JSON.parse(jsonified) as Record<string, unknown>;
      toolCalls.push({
        id: `text_${Math.random().toString(36).slice(2, 9)}`,
        name,
        arguments: args,
      });
    } catch {
      // fallback: treat entire argsRaw as a single "query" param
      toolCalls.push({
        id: `text_${Math.random().toString(36).slice(2, 9)}`,
        name,
        arguments: { query: argsRaw.trim() },
      });
    }
    return "";
  });

  // Strip any leftover <eos> tokens from local models
  cleanText = cleanText.replace(/<eos>/g, "").trim();

  return { toolCalls, cleanText };
}

// ─── Message Formatting Helpers ──────────────────────────────────────────────

/** Format a ChatMessage for the Anthropic Messages API */
export function formatMessageForAnthropic(msg: ChatMessage): Record<string, unknown> {
  // Tool result messages → Anthropic uses role=user with tool_result content block
  if (msg.role === "tool" && msg.toolCallId) {
    return {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: msg.toolCallId, content: typeof msg.content === "string" ? msg.content : "" }],
    };
  }
  // Assistant messages with tool calls → content block array with text + tool_use blocks
  if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
    const textContent = typeof msg.content === "string" ? msg.content : "";
    return {
      role: "assistant",
      content: [
        ...(textContent ? [{ type: "text" as const, text: textContent }] : []),
        ...msg.toolCalls.map((tc) => ({ type: "tool_use" as const, id: tc.id, name: tc.name, input: tc.arguments })),
      ],
    };
  }
  // Multimodal user input (text + image blocks) → Anthropic content array.
  if (Array.isArray(msg.content) && isMultimodalInputContent(msg.content)) {
    return {
      role: msg.role,
      content: msg.content.map((b) => {
        if (b.type === "image_url") return imageUrlToAnthropicBlock(b.image_url.url);
        // isMultimodalInputContent guarantees the only other member is text.
        return { type: "text", text: b.type === "text" ? b.text : "" };
      }),
    };
  }
  // Plain messages — pass through with string content
  return { role: msg.role, content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content) };
}

/** Format a ChatMessage for the OpenAI Chat Completions API */
export function formatMessageForOpenAI(msg: ChatMessage): Record<string, unknown> {
  // Tool result messages → role=tool with tool_call_id
  if (msg.role === "tool" && msg.toolCallId) {
    return { role: "tool", tool_call_id: msg.toolCallId, content: typeof msg.content === "string" ? msg.content : "" };
  }
  // Assistant messages with tool calls → tool_calls field
  if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
    return {
      role: "assistant",
      content: typeof msg.content === "string" ? msg.content : "",
      tool_calls: msg.toolCalls.map((tc) => ({
        id: tc.id, type: "function",
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      })),
    };
  }
  // Multimodal user input (text + image_url + input_audio blocks) → pass through
  // as-is; this is already the OpenAI Chat Completions multimodal wire format.
  if (Array.isArray(msg.content) && isOpenAIInputContent(msg.content)) {
    return { role: msg.role, content: msg.content };
  }
  // Plain messages — pass through with string content
  return { role: msg.role, content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content) };
}

/** Format a ChatMessage for the OpenAI Responses API input array */
export function formatMessageForResponses(msg: ChatMessage): Array<Record<string, unknown>> {
  const textContent = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);

  if (msg.role === "tool" && msg.toolCallId) {
    return [{ type: "function_call_output", call_id: msg.toolCallId, output: textContent }];
  }

  if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
    return [
      ...(textContent ? [{ role: "assistant", content: textContent }] : []),
      ...msg.toolCalls.map((tc) => ({
        type: "function_call",
        call_id: tc.id,
        name: tc.name,
        arguments: JSON.stringify(tc.arguments),
      })),
    ];
  }

  return [{ role: msg.role, content: textContent }];
}
