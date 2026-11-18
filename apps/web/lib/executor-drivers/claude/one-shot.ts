// Claude Code as a one-shot run (BI-A01B06F6): `claude -p -` with the prompt
// on stdin and a single json result on stdout. Build Studio dispatch, Ideate
// and inference routing each built this command and read its result their own
// way; this is the one copy. The flag order is the order all three used, so
// each caller's command line is unchanged.
//
// Each caller keeps its own process envelope (working directory, user, owned
// runner, timeout and uncertainty handling); the driver owns what the CLI is
// told and what its answer means.

import type { ToolCallEntry } from "@/lib/routing/chat-message-types";
import { extractToolCalls as extractToolCallsFromText } from "@/lib/routing/extract-tool-calls";
import { toCliParsedUsage, type CliParsedUsage, type CliUsagePayload } from "@/lib/routing/cli-usage";

/**
 * Claude Code's built-in tools shadow the platform's tools when both are
 * offered: the model prefers native `tool_use` for Read, Write, Bash and the
 * rest (BI-931303FF). Inference routing turns them off; Build Studio dispatch,
 * which is a coding run, keeps them. A new built-in in a later Claude Code
 * release brings the shadowing back until it is added here; the [tool-trace]
 * log lines surface that regression.
 */
const CLAUDE_CODE_NATIVE_TOOLS = [
  "Agent", "Bash", "Edit", "Glob", "Grep", "MultiEdit", "NotebookEdit", "NotebookRead",
  "Read", "Skill", "Task", "TodoWrite", "ToolSearch", "WebFetch", "WebSearch", "Write",
];

/** Comma-separated form of the native tool list for `--disallowedTools`. */
export const CLAUDE_CODE_NATIVE_TOOLS_FLAG_VALUE = CLAUDE_CODE_NATIVE_TOOLS.join(",");

export type ClaudeOneShotOptions = {
  authMode: "oauth" | "apikey";
  /** Continue an earlier Claude Code session (Build Studio task continuity). */
  sessionId?: string;
  /** Directories the run may read without making them its project root (Ideate). */
  addDirs?: string[];
  /** Mount the platform MCP server from this config file. */
  mcpConfigFile?: string;
  /** Turn Claude Code's native tools off (inference routing). */
  disallowNativeTools?: boolean;
  model?: string | null;
};

/** The arguments after `claude`. The prompt is read from stdin (`-p -`). */
export function claudeOneShotArgs(options: ClaudeOneShotOptions): string[] {
  return [
    // --bare disables OAuth, so it is only safe with an API key.
    ...(options.authMode === "apikey" ? ["--bare"] : []),
    ...(options.sessionId ? ["--session-id", options.sessionId] : []),
    "-p", "-", "--dangerously-skip-permissions",
    ...(options.addDirs ?? []).flatMap((dir) => ["--add-dir", dir]),
    ...(options.mcpConfigFile ? ["--mcp-config", options.mcpConfigFile, "--strict-mcp-config"] : []),
    ...(options.disallowNativeTools ? ["--disallowedTools", CLAUDE_CODE_NATIVE_TOOLS_FLAG_VALUE] : []),
    "--output-format", "json",
    ...(options.model ? ["--model", options.model] : []),
  ];
}

/**
 * Tool calls with this prefix were dispatched by the CLI itself against the
 * `--mcp-config` server, so they have already run by the time the result is
 * read. A caller must never run them again.
 */
const MCP_TOOL_NAME_PREFIX = "mcp__dpf__";

export type ClaudeOneShotResult = {
  text: string;
  /** The output was the CLI's JSON result object (not an error string or other text). */
  json: boolean;
  /** False when the CLI's result carried no `result` field, or was not JSON. */
  hasResult: boolean;
  isError: boolean;
  sessionId?: string;
  costUsd?: number;
  usage: CliParsedUsage;
  /** False when the CLI reported no usage: the zero counts in `usage` are then not a measurement. */
  usageReported: boolean;
  toolCalls: ToolCallEntry[];
  /** Platform tools the CLI already ran over MCP, with the `mcp__dpf__` prefix removed. */
  cliPreExecutedNames: string[];
};

/** Read `claude -p --output-format json` output. */
export function parseClaudeResult(output: string): ClaudeOneShotResult {
  let parsed: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(output.trim());
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    parsed = value as Record<string, unknown>;
  } catch {
    // Not JSON (the CLI printed an error string, or a bare tool_use block).
    const raw = output.trim();
    return {
      text: raw, json: false, hasResult: false, isError: false, usage: toCliParsedUsage(undefined), usageReported: false,
      toolCalls: raw.includes('"tool_use"') ? extractToolCallsFromText(raw) : [], cliPreExecutedNames: [],
    };
  }

  const text = typeof parsed["result"] === "string" ? parsed["result"] : JSON.stringify(parsed["result"] ?? "");
  const toolCalls: ToolCallEntry[] = [];
  const cliPreExecutedNames: string[] = [];
  const content = parsed["content"] as Array<{ type?: string; id?: string; name?: string; input?: Record<string, unknown> }> | undefined;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block.type !== "tool_use" || !block.name) continue;
      if (block.name.startsWith(MCP_TOOL_NAME_PREFIX)) cliPreExecutedNames.push(block.name.slice(MCP_TOOL_NAME_PREFIX.length));
      else toolCalls.push({ id: block.id ?? `cli_${Math.random().toString(36).slice(2, 9)}`, name: block.name, arguments: block.input ?? {} });
    }
  }
  // The model sometimes writes the tool_use JSON as its answer instead of calling the tool.
  if (toolCalls.length === 0 && text.includes('"tool_use"')) toolCalls.push(...extractToolCallsFromText(text));

  const usage = parsed["usage"] as CliUsagePayload | undefined;
  return {
    text,
    json: true,
    hasResult: parsed["result"] !== undefined,
    isError: parsed["is_error"] === true,
    ...(typeof parsed["session_id"] === "string" ? { sessionId: parsed["session_id"] } : {}),
    ...(typeof parsed["total_cost_usd"] === "number" ? { costUsd: parsed["total_cost_usd"] } : {}),
    usage: toCliParsedUsage(usage),
    usageReported: Boolean(usage && typeof usage === "object"),
    toolCalls,
    cliPreExecutedNames,
  };
}
