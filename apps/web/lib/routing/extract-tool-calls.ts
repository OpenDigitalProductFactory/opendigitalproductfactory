// apps/web/lib/routing/extract-tool-calls.ts

/**
 * Cross-adapter tool_use extractor.
 *
 * Pulls tool_use invocations out of CLI-style LLM text output that isn't
 * already a structured tool_call from the provider's native API. Models
 * emit several variants when asked to "respond with tool_use blocks":
 *
 *   1. {"type":"tool_use","id":"x","name":"t","input":{...}}   (Claude/Anthropic spec)
 *   2. {"name":"t","input":{...}}                              (no type/id)
 *   3. {"tool":"t","arguments":{...}}                          (alt key names)
 *   4. <tool_use>{...}</tool_use>                              (XML-ish wrapper)
 *   5. ```json\n{...}\n```                                     (markdown fence)
 *
 * Shared by `codex-cli-adapter.ts` and `cli-adapter.ts` (Claude CLI) so
 * neither adapter silently drops tool calls when the model picks a
 * non-canonical shape.
 */

import type { ToolCallEntry } from "./adapter-types";

/** Deterministic JSON stringify with sorted object keys for content-based dedup. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(",")}}`;
}

/**
 * Returns the index of the `}` that closes the object starting at `openIdx`,
 * or -1 if not well-balanced. Respects JSON string literals so braces inside
 * strings don't throw off the depth counter.
 */
function findBalancedEnd(text: string, openIdx: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export function extractToolCalls(text: string): ToolCallEntry[] {
  const toolCalls: ToolCallEntry[] = [];
  const seen = new Set<string>();
  const candidates: string[] = [];

  // a) <tool_use>...</tool_use>
  const xmlPattern = /<tool_use>\s*([\s\S]*?)\s*<\/tool_use>/gi;
  for (let m; (m = xmlPattern.exec(text)) !== null; ) {
    if (m[1]) candidates.push(m[1].trim());
  }

  // b) ```json | ```tool_use | ``` fenced blocks
  const fencePattern = /```(?:json|tool_use)?\s*([\s\S]*?)```/g;
  for (let m; (m = fencePattern.exec(text)) !== null; ) {
    if (m[1]) candidates.push(m[1].trim());
  }

  // c) Inline JSON objects whose first key is type | name | tool. Brace-
  //    balancing walk rather than non-greedy regex so nested args parse.
  const keyStartPattern = /\{\s*"(?:type|name|tool)"\s*:/g;
  for (let start; (start = keyStartPattern.exec(text)) !== null; ) {
    const end = findBalancedEnd(text, start.index);
    if (end > start.index) candidates.push(text.slice(start.index, end + 1));
  }

  for (const raw of candidates) {
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;

    const name =
      (typeof parsed.name === "string" && parsed.name) ||
      (typeof parsed.tool === "string" && parsed.tool) ||
      null;
    const input =
      (parsed.input && typeof parsed.input === "object" ? parsed.input : null) ??
      (parsed.arguments && typeof parsed.arguments === "object" ? parsed.arguments : null) ??
      {};
    if (!name) continue;

    // Accept type:"tool_use" or no type (when shape is clear)
    if (parsed.type !== undefined && parsed.type !== "tool_use") continue;

    const id =
      (typeof parsed.id === "string" && parsed.id) ||
      `call_${toolCalls.length}_${name}`;

    // Dedupe by (name, canonical args) — the same call in both XML-wrapped
    // and inline shapes shouldn't fire twice.
    const semanticKey = `${name}:${stableStringify(input)}`;
    if (seen.has(semanticKey)) continue;
    seen.add(semanticKey);

    toolCalls.push({
      id,
      name,
      arguments: input as Record<string, unknown>,
    });
  }

  return toolCalls;
}
