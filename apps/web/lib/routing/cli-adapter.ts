// apps/web/lib/routing/cli-adapter.ts

/**
 * Claude CLI execution adapter for anthropic-sub (OAuth subscription) users.
 *
 * OAuth tokens are NOT supported on the direct Anthropic Messages API.
 * Instead, this adapter routes inference through the Claude Code CLI
 * (`claude -p`) which uses Anthropic's subscription infrastructure with
 * generous rolling-window rate limits.
 *
 * The CLI runs inside the sandbox container via `docker exec`. Auth is
 * injected via the CLAUDE_CODE_OAUTH_TOKEN env var (same pattern as
 * claude-dispatch.ts for build tasks).
 *
 * For the `anthropic` provider (API key), the normal chat adapter is used
 * unchanged — this adapter is ONLY for `anthropic-sub`.
 */

import type { AdapterRequest, AdapterResult, ExecutionAdapterHandler, ToolCallEntry } from "./adapter-types";
import { InferenceError } from "@/lib/ai-inference";
import { getDecryptedCredential, getProviderBearerToken } from "@/lib/inference/ai-provider-internals";
import { registerExecutionAdapter } from "./execution-adapter-registry";
import { lazyChildProcess, lazyUtil } from "@/lib/shared/lazy-node";
import { extractToolCalls as extractToolCallsFromText } from "./extract-tool-calls";

const SANDBOX_CONTAINER = process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1";
const CLI_TIMEOUT_MS = 180_000; // 3 minutes — matches chat adapter's AbortSignal.timeout

// ─── Auth Resolution ────────────────────────────────────────────────────────

type CliAuth =
  | { mode: "oauth"; token: string }
  | { mode: "apikey"; apiKey: string };

async function resolveCliAuth(providerId: string): Promise<CliAuth> {
  if (providerId === "anthropic-sub") {
    // Use getProviderBearerToken which handles token refresh automatically.
    // The raw getDecryptedCredential doesn't refresh expired tokens — it just
    // reads whatever is cached. getProviderBearerToken checks expiry, refreshes
    // if needed, and returns a valid token.
    const tokenResult = await getProviderBearerToken(providerId);
    if ("error" in tokenResult) {
      throw new InferenceError(
        `OAuth token error for "${providerId}": ${tokenResult.error}. Configure via Admin > AI Workforce > External Services.`,
        "auth",
        providerId,
      );
    }
    return { mode: "oauth", token: tokenResult.token };
  }

  // Fallback: API key mode (shouldn't normally reach here — anthropic uses chat adapter)
  const credential = await getDecryptedCredential(providerId);
  const apiKey = credential?.secretRef ?? credential?.cachedToken;
  if (!apiKey) {
    throw new InferenceError(
      `No API key for provider "${providerId}".`,
      "auth",
      providerId,
    );
  }
  return { mode: "apikey", apiKey };
}

// ─── Claude CLI stream-json parsing ─────────────────────────────────────────

interface CliStreamEvent {
  type: string;
  content?: string;
  subtype?: string;
  name?: string;
  id?: string;
  input?: Record<string, unknown>;
  result?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  // tool_use events may have these at top level
  tool_use_id?: string;
}

/**
 * Parse Claude CLI `--output-format stream-json` output into AdapterResult.
 *
 * Each line is a JSON object. Key event types:
 * - {"type":"assistant","subtype":"text","content":"..."} — text chunk
 * - {"type":"tool_use","name":"...","input":{...}} — tool call
 * - {"type":"result","result":"...","usage":{...}} — completion
 */
function parseCliStreamOutput(output: string): {
  text: string;
  toolCalls: ToolCallEntry[];
  usage: { inputTokens: number; outputTokens: number };
} {
  const textParts: string[] = [];
  const toolCalls: ToolCallEntry[] = [];
  let inputTokens = 0;
  let outputTokens = 0;

  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let event: CliStreamEvent;
    try {
      event = JSON.parse(trimmed) as CliStreamEvent;
    } catch {
      continue; // Skip non-JSON lines (stderr leakage, progress messages)
    }

    if (event.type === "assistant" && event.content) {
      textParts.push(event.content);
    } else if (event.type === "tool_use" && event.name) {
      toolCalls.push({
        id: event.id ?? event.tool_use_id ?? `cli_${Math.random().toString(36).slice(2, 9)}`,
        name: event.name,
        arguments: event.input ?? {},
      });
    } else if (event.type === "result") {
      // Final event — contains aggregated result and usage
      if (event.result && textParts.length === 0) {
        textParts.push(event.result);
      }
      if (event.usage) {
        inputTokens = event.usage.input_tokens ?? 0;
        outputTokens = event.usage.output_tokens ?? 0;
      }
    }
  }

  const finalText = textParts.join("");
  // Rescue: if the model emitted tool_use JSON as assistant text instead of
  // a structured tool_use event (observed on anthropic-sub CLI when Claude
  // writes the canonical {"type":"tool_use",…} JSON in a chat turn),
  // extract the tool calls from the text so the agentic loop dispatches.
  if (toolCalls.length === 0 && finalText.includes('"tool_use"')) {
    const rescued = extractToolCallsFromText(finalText);
    if (rescued.length > 0) {
      toolCalls.push(...rescued);
    }
  }

  return {
    text: finalText,
    toolCalls,
    usage: { inputTokens, outputTokens },
  };
}

/**
 * Fallback parser for `--output-format json` (non-streaming).
 * Returns { result: string, session_id?: string, ... }
 */
function parseCliJsonOutput(output: string): {
  text: string;
  toolCalls: ToolCallEntry[];
  usage: { inputTokens: number; outputTokens: number };
} {
  try {
    const parsed = JSON.parse(output.trim()) as Record<string, unknown>;
    const text = typeof parsed.result === "string" ? parsed.result : JSON.stringify(parsed.result ?? "");

    // Extract tool calls from content blocks if present
    const toolCalls: ToolCallEntry[] = [];
    const content = parsed.content as Array<{ type?: string; id?: string; name?: string; input?: Record<string, unknown> }> | undefined;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "tool_use" && block.name) {
          toolCalls.push({
            id: block.id ?? `cli_${Math.random().toString(36).slice(2, 9)}`,
            name: block.name,
            arguments: block.input ?? {},
          });
        }
      }
    }

    const usage = parsed.usage as { input_tokens?: number; output_tokens?: number } | undefined;

    // Same rescue as parseCliStreamOutput: tool_use may appear in the text
    // instead of in a content-block tool_use entry.
    if (toolCalls.length === 0 && text.includes('"tool_use"')) {
      const rescued = extractToolCallsFromText(text);
      if (rescued.length > 0) {
        toolCalls.push(...rescued);
      }
    }

    return {
      text,
      toolCalls,
      usage: {
        inputTokens: usage?.input_tokens ?? 0,
        outputTokens: usage?.output_tokens ?? 0,
      },
    };
  } catch {
    // Not JSON — return raw text. Try to extract tool calls from the raw
    // text before giving up; the CLI occasionally prints a single JSON
    // tool_use block with no wrapper.
    const raw = output.trim();
    const rescued = raw.includes('"tool_use"') ? extractToolCallsFromText(raw) : [];
    return {
      text: raw,
      toolCalls: rescued,
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
}

// ─── CLI Adapter ────────────────────────────────────────────────────────────

export const cliAdapter: ExecutionAdapterHandler = {
  type: "claude-cli",

  async execute(request: AdapterRequest): Promise<AdapterResult> {
    const { providerId, modelId, messages, systemPrompt, tools } = request;
    const startMs = Date.now();

    // 1. Resolve auth
    const auth = await resolveCliAuth(providerId);

    // 2. Build the prompt from messages
    // Claude CLI's `-p` flag takes a single prompt string. We concatenate
    // the conversation history into a structured format the model understands.
    const promptParts: string[] = [];
    for (const msg of messages) {
      if (msg.role === "system") continue; // system prompt passed separately
      const content = typeof msg.content === "string"
        ? msg.content
        : JSON.stringify(msg.content);

      if (msg.role === "user") {
        promptParts.push(`Human: ${content}`);
      } else if (msg.role === "assistant") {
        promptParts.push(`Assistant: ${content}`);
      } else if (msg.role === "tool" && msg.toolCallId) {
        promptParts.push(`Tool Result (${msg.toolCallId}): ${content}`);
      }
    }
    const prompt = promptParts.join("\n\n");

    // 3. Build tool definitions for --allowedTools or --mcp-config
    // For platform MCP tools (create_backlog_item, etc.), we pass them as
    // tool descriptions in the system prompt so Claude knows about them.
    // The agentic loop intercepts tool_use events and executes them server-side.
    let toolContext = "";
    if (tools && tools.length > 0) {
      const toolDescriptions = tools.map((t) => {
        const fn = (t as { type?: string; function?: { name?: string; description?: string; parameters?: unknown } }).function;
        if (fn) {
          return `- ${fn.name}: ${fn.description ?? ""}${fn.parameters ? ` Parameters: ${JSON.stringify(fn.parameters)}` : ""}`;
        }
        return `- ${JSON.stringify(t)}`;
      });
      // Be explicit about the tool_use JSON shape. The Claude CLI's
      // stream-json parser only recognises STRUCTURED tool_use events emitted
      // as top-level stream entries — tool_use JSON embedded inside
      // assistant-text content leaks through as plain chat (observed on
      // /build with anthropic-sub). The downstream fallback extractor below
      // rescues such cases; the prompt still asks for the canonical shape.
      toolContext =
        `\n\nAvailable tools. To invoke a tool, output ONE JSON object per ` +
        `invocation using exactly this shape:\n` +
        `{"type":"tool_use","id":"<unique_id>","name":"<tool_name>","input":{<args>}}\n` +
        `Do NOT wrap in XML tags, markdown code fences, or rename the keys. ` +
        `Output only the JSON (no surrounding prose) when invoking a tool.\n\n` +
        `Tools:\n${toolDescriptions.join("\n")}`;
    }

    const fullSystemPrompt = systemPrompt + toolContext;

    // 4. Write prompt and system prompt to temp files in the sandbox
    const slug = `conv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const promptFile = `/tmp/cli-prompt-${slug}.txt`;
    const systemFile = `/tmp/cli-system-${slug}.txt`;
    const tokenFile = `/tmp/cli-token-${slug}.txt`;
    const runnerScript = `/tmp/cli-run-${slug}.sh`;

    const cp = lazyChildProcess();
    const execAsync = lazyUtil().promisify(cp.exec);
    const spawnCb = cp.spawn;

    try {
      // Write prompt and system prompt to sandbox
      const promptB64 = Buffer.from(prompt).toString("base64");
      const systemB64 = Buffer.from(fullSystemPrompt).toString("base64");

      await Promise.all([
        execAsync(
          `docker exec ${SANDBOX_CONTAINER} sh -c "echo '${promptB64}' | base64 -d > ${promptFile} && chmod 644 ${promptFile}"`,
          { timeout: 5_000 },
        ),
        execAsync(
          `docker exec ${SANDBOX_CONTAINER} sh -c "echo '${systemB64}' | base64 -d > ${systemFile} && chmod 644 ${systemFile}"`,
          { timeout: 5_000 },
        ),
      ]);

      // 5. Build auth env and runner script
      let authExportLine: string;
      let bareFlag = "";
      if (auth.mode === "oauth") {
        const tokenB64 = Buffer.from(auth.token).toString("base64");
        await execAsync(
          `docker exec ${SANDBOX_CONTAINER} sh -c "echo '${tokenB64}' | base64 -d > ${tokenFile} && chmod 644 ${tokenFile}"`,
          { timeout: 5_000 },
        );
        authExportLine = `export CLAUDE_CODE_OAUTH_TOKEN=$(cat ${tokenFile})`;
      } else {
        authExportLine = `export ANTHROPIC_API_KEY=${auth.apiKey}`;
        bareFlag = "--bare ";
      }

      // Build the CLI command
      // Use --output-format json for reliable parsing (stream-json is for streaming UX)
      // Read prompt from stdin (< file) to avoid shell quoting issues with large prompts.
      // System prompt is read from file and passed via env var to avoid $(cat) in args.
      const cliModel = modelId || "sonnet";
      const script = [
        "#!/bin/sh",
        "cd /workspace",
        authExportLine,
        `SYSPROMPT=$(cat ${systemFile})`,
        `exec claude ${bareFlag}-p - --dangerously-skip-permissions --output-format json --model ${cliModel} --system-prompt "$SYSPROMPT" < ${promptFile}`,
      ].join("\n");

      const scriptB64 = Buffer.from(script).toString("base64");
      await execAsync(
        `docker exec ${SANDBOX_CONTAINER} sh -c "echo '${scriptB64}' | base64 -d > ${runnerScript} && chmod 755 ${runnerScript}"`,
        { timeout: 5_000 },
      );

      // 6. Spawn the CLI process
      console.log(`[cli-adapter] Dispatching to Claude CLI: model=${cliModel}, provider=${providerId}, messages=${messages.length}`);

      const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
        const proc = spawnCb("docker", [
          "exec", "--user", "node", SANDBOX_CONTAINER, runnerScript,
        ]);

        let stdout = "";
        let stderr = "";
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          proc.kill("SIGTERM");
        }, CLI_TIMEOUT_MS);

        proc.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
        proc.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });

        proc.on("close", (code: number | null) => {
          clearTimeout(timer);
          if (timedOut) {
            reject(new InferenceError(
              `Claude CLI timed out after ${CLI_TIMEOUT_MS / 1000}s`,
              "provider_error",
              providerId,
            ));
          } else if (code === 0 || stdout.trim()) {
            resolve({ stdout });
          } else {
            // Check for auth errors in stderr
            if (stderr.includes("unauthorized") || stderr.includes("401") || stderr.includes("authentication")) {
              reject(new InferenceError(
                `Claude CLI auth failed: ${stderr.slice(0, 300)}`,
                "auth",
                providerId,
              ));
            } else if (stderr.includes("rate") || stderr.includes("429")) {
              reject(new InferenceError(
                `Claude CLI rate limited: ${stderr.slice(0, 300)}`,
                "rate_limit",
                providerId,
              ));
            } else {
              reject(new InferenceError(
                `Claude CLI exit code ${code}: ${stderr.slice(0, 500)}`,
                "provider_error",
                providerId,
              ));
            }
          }
        });

        proc.on("error", (err: Error) => {
          clearTimeout(timer);
          reject(new InferenceError(
            `Claude CLI spawn error: ${err.message}`,
            "network",
            providerId,
          ));
        });
      });

      // 7. Parse the output
      const parsed = parseCliJsonOutput(stdout);
      const inferenceMs = Date.now() - startMs;

      console.log(
        `[cli-adapter] Completed: ${parsed.text.length} chars, ` +
        `${parsed.toolCalls.length} tool calls, ${inferenceMs}ms`,
      );

      // ── Durable tool-call extraction trace (mirrors codex-cli-adapter) ──
      // See note there. Kept on until tool dispatch is 100% reliable.
      const toolKeywordPattern = /\b(read_sandbox_file|write_sandbox_file|edit_sandbox_file|search_sandbox|list_sandbox_files|run_sandbox_command|check_sandbox|start_sandbox|saveBuildEvidence|save_build_notes|save_phase_handoff|reviewDesignDoc|reviewBuildPlan|search_project_files|read_project_file|list_project_directory|generate_design_system|search_design_intelligence|describe_model|deploy_feature|execute_promotion)\b/g;
      const mentionedNames = Array.from(new Set(parsed.text.match(toolKeywordPattern) ?? []));
      const extractedNames = parsed.toolCalls.map((c) => c.name);
      console.log(
        `[tool-trace] adapter=claude-cli extracted=${parsed.toolCalls.length} names=${JSON.stringify(extractedNames)} mentioned=${JSON.stringify(mentionedNames)}`,
      );
      if (parsed.toolCalls.length === 0 && mentionedNames.length > 0) {
        console.log(
          `[tool-trace] adapter=claude-cli NO-CALL-BUT-MENTIONED raw=${JSON.stringify(parsed.text.slice(0, 8000))}`,
        );
      } else if (parsed.toolCalls.length > 0) {
        console.log(
          `[tool-trace] adapter=claude-cli CALLS-PARSED head=${JSON.stringify(parsed.text.slice(0, 600))}`,
        );
      }

      return {
        text: parsed.text,
        toolCalls: parsed.toolCalls,
        usage: parsed.usage,
        inferenceMs,
      };
    } finally {
      // Clean up temp files (fire-and-forget)
      execAsync(
        `docker exec ${SANDBOX_CONTAINER} sh -c "rm -f ${promptFile} ${systemFile} ${tokenFile} ${runnerScript}"`,
        { timeout: 5_000 },
      ).catch(() => {});
    }
  },
};

// ── Auto-register at import time ─────────────────────────────────────────────

registerExecutionAdapter(cliAdapter);
