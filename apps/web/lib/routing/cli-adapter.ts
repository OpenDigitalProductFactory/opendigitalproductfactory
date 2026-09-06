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
import { writeSandboxFile } from "@/lib/build/sandbox/agent-cli-runtime";
import { extractToolCalls as extractToolCallsFromText } from "./extract-tool-calls";
import { createMcpSessionToken } from "@/lib/mcp/session-token";
import { getToolGrantMapping } from "@/lib/tak/agent-grants";
import { recordCliRateLimit, clearCliRateLimit } from "./cli-pool-status";
import { withCliSlot } from "./cli-concurrency";
import { isSideEffectingGrant } from "./grant-capability";


const SANDBOX_CONTAINER = process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1";
const CLI_TIMEOUT_MS = 600_000; // 10 minutes — accumulated Build Studio context (>100K chars) takes longer than 3 min to process

/** Internal portal URL the sandbox uses to reach `/api/mcp/v1`. The standard
 *  self-host docker bridge resolves `portal` to the portal container; override
 *  for non-standard layouts (e.g. host-network setups) via env. */
const INTERNAL_PORTAL_URL = process.env.DPF_INTERNAL_PORTAL_URL ?? "http://portal:3000";

/**
 * Claude Code CLI's built-in tools shadow the platform's MCP-style tools when
 * both are available — the model preferentially emits native `tool_use` for
 * its own tools (Read, Write, Bash, Agent, etc.) instead of using the
 * platform-tool descriptions injected into the system prompt. That looked
 * like "Build Studio tools aren't being called" (BI-931303FF).
 *
 * Until the proper fix lands (mount platform tools as a real MCP server via
 * `--mcp-config` per docs/superpowers/plans/2026-04-11-platform-mcp-tool-server-implementation.md),
 * we suppress Claude Code's native tools when this adapter dispatches
 * inference. The cli-adapter is only used as an inference backend (anthropic-sub
 * subscription), not as a coding assistant — sub-agent code execution flows
 * through claude-dispatch.ts on a different code path that intentionally
 * keeps native tools enabled.
 *
 * List sourced from Claude Code 1.x's documented built-in tool inventory.
 * If a future Claude Code release adds a new built-in, the platform tool
 * shadowing returns until this list is updated; the [tool-trace] log lines
 * in this file will surface the regression.
 */
const CLAUDE_CODE_NATIVE_TOOLS = [
  "Agent",
  "Bash",
  "Edit",
  "Glob",
  "Grep",
  "MultiEdit",
  "NotebookEdit",
  "NotebookRead",
  "Read",
  "Skill",
  "Task",
  "TodoWrite",
  "ToolSearch",
  "WebFetch",
  "WebSearch",
  "Write",
];

/** Comma-separated form of {@link CLAUDE_CODE_NATIVE_TOOLS} for the `--disallowedTools` flag. */
export const CLAUDE_CODE_NATIVE_TOOLS_FLAG_VALUE = CLAUDE_CODE_NATIVE_TOOLS.join(",");

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
 * Tool calls with this prefix are dispatched by the Claude CLI itself against
 * a `--mcp-config`-mounted server. They have already been executed by the CLI
 * by the time we see the output; the agentic loop must NOT re-execute them.
 * Filter them out at the parser level so even if a future CLI version surfaces
 * the unresolved tool_use in the final JSON, we won't double-dispatch.
 */
const MCP_TOOL_NAME_PREFIX = "mcp__dpf__";

export const TOOL_TRACE_KEYWORD_PATTERN = /\b(read_sandbox_file|write_sandbox_file|edit_sandbox_file|search_sandbox|list_sandbox_files|run_sandbox_command|check_sandbox|start_sandbox|saveBuildEvidence|save_build_notes|save_phase_handoff|reviewDesignDoc|reviewBuildPlan|search_project_files|read_project_file|list_project_directory|get_code_graph_freshness|inspect_build_code_impact|search_code_graph|trace_code_surface|find_related_tests|generate_design_system|search_design_intelligence|describe_model|deploy_feature|execute_promotion)\b/g;

export function extractMentionedPlatformToolNames(text: string): string[] {
  return Array.from(new Set(text.match(TOOL_TRACE_KEYWORD_PATTERN) ?? []));
}

/**
 * Parse Claude CLI `--output-format stream-json` output into AdapterResult.
 *
 * Each line is a JSON object. Key event types:
 * - {"type":"assistant","subtype":"text","content":"..."} — text chunk
 * - {"type":"tool_use","name":"...","input":{...}} — tool call
 * - {"type":"result","result":"...","usage":{...}} — completion
 */
export function parseCliStreamOutput(output: string): {
  text: string;
  toolCalls: ToolCallEntry[];
  usage: { inputTokens: number; outputTokens: number };
  /**
   * mcp__dpf__* tool calls that the CLI's MCP client already executed before
   * we saw the output. Filtered out of `toolCalls` (so the agentic loop does
   * NOT re-dispatch and double-execute side effects), but surfaced here so
   * the diagnostic tracer can avoid logging NO-CALL-BUT-MENTIONED when the
   * post-execution narration mentions a tool name the CLI already ran.
   * Names have the `mcp__dpf__` prefix stripped for easier comparison
   * against extractMentionedPlatformToolNames output.
   */
  cliPreExecutedNames: string[];
} {
  const textParts: string[] = [];
  const toolCalls: ToolCallEntry[] = [];
  const cliPreExecutedNames: string[] = [];
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
      if (event.name.startsWith(MCP_TOOL_NAME_PREFIX)) {
        cliPreExecutedNames.push(event.name.slice(MCP_TOOL_NAME_PREFIX.length));
      } else {
        toolCalls.push({
          id: event.id ?? event.tool_use_id ?? `cli_${Math.random().toString(36).slice(2, 9)}`,
          name: event.name,
          arguments: event.input ?? {},
        });
      }
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
    cliPreExecutedNames,
  };
}

/**
 * Fallback parser for `--output-format json` (non-streaming).
 * Returns { result: string, session_id?: string, ... }
 */
export function parseCliJsonOutput(output: string): {
  text: string;
  toolCalls: ToolCallEntry[];
  usage: { inputTokens: number; outputTokens: number };
  /** See parseCliStreamOutput.cliPreExecutedNames for the contract. */
  cliPreExecutedNames: string[];
} {
  try {
    const parsed = JSON.parse(output.trim()) as Record<string, unknown>;
    const text = typeof parsed.result === "string" ? parsed.result : JSON.stringify(parsed.result ?? "");

    // Extract tool calls from content blocks if present. Skip mcp__dpf__*
    // entries — those were already dispatched by the CLI's MCP client and
    // re-running them in the agentic loop would double-execute side effects.
    const toolCalls: ToolCallEntry[] = [];
    const cliPreExecutedNames: string[] = [];
    const content = parsed.content as Array<{ type?: string; id?: string; name?: string; input?: Record<string, unknown> }> | undefined;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "tool_use" && block.name) {
          if (block.name.startsWith(MCP_TOOL_NAME_PREFIX)) {
            cliPreExecutedNames.push(block.name.slice(MCP_TOOL_NAME_PREFIX.length));
          } else {
            toolCalls.push({
              id: block.id ?? `cli_${Math.random().toString(36).slice(2, 9)}`,
              name: block.name,
              arguments: block.input ?? {},
            });
          }
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
      cliPreExecutedNames,
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
      cliPreExecutedNames: [],
    };
  }
}

function isProviderOverloadMessage(text: string): boolean {
  return /\b529\b|overloaded/i.test(text);
}

/**
 * The CLI's own usage-limit banner (BI-QUOTA-DEAD-END).
 *
 * Claude CLI prints "You've hit your weekly limit · resets 4pm (UTC)" on
 * stdout when a subscription quota is exhausted. The adapter classified auth
 * errors and overload but had no branch for quota, so this fell through and
 * became the assistant's reply verbatim. Measured on the live install: 23
 * occurrences — 21 where the banner WAS the entire reply (a dead end with no
 * routing signal, so failover never fired) and 2 where it was prepended to a
 * genuine answer, corrupting a good reply.
 *
 * Deliberately narrow. It matches the banner's own shape rather than the word
 * "limit", which appears in ordinary prose ("the weekly limit on spend is…").
 */
const CLI_QUOTA_BANNER = /(?:you(?:'|’)?ve\s+)?hit\s+your\s+(?:weekly|daily|monthly|usage)\s+limit/i;

export function isCliQuotaBanner(text: string): boolean {
  return CLI_QUOTA_BANNER.test(text);
}

/**
 * Remove a leading quota banner so a genuine reply behind it survives.
 *
 * All 23 observed occurrences started with the banner; it is a prefix the CLI
 * emits before whatever else it was going to say. Stripping only a LEADING
 * match keeps the function from mangling a reply that legitimately discusses
 * usage limits further down.
 */
export function stripLeadingQuotaBanner(text: string): string {
  const firstBreak = text.search(/\n|(?<=\))\s/);
  const head = firstBreak === -1 ? text : text.slice(0, firstBreak);
  if (!CLI_QUOTA_BANNER.test(head)) return text;
  return text.slice(head.length).trimStart();
}

// ─── CLI Adapter ────────────────────────────────────────────────────────────

export const cliAdapter: ExecutionAdapterHandler = {
  type: "claude-cli",

  async execute(request: AdapterRequest): Promise<AdapterResult> {
    const { providerId, modelId, messages, systemPrompt, tools, mcpSession } = request;
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

    // 3. Decide tool delivery mode.
    //
    //    NATIVE-MCP mode (when `mcpSession` AND `tools` are both present):
    //      Mount the platform MCP server at `/api/mcp/v1` via `--mcp-config`.
    //      The CLI calls `tools/list` on the server during startup, surfaces
    //      the platform tools to the model as native `mcp__dpf__*` tool_use
    //      definitions, and dispatches each `tool_use` block back through
    //      the MCP server. The agentic loop never sees those calls — they
    //      are executed inside the CLI session and only the final assistant
    //      text returns. This is the post-#510 architecture.
    //
    //    LEGACY mode (everything else: no mcpSession, or no tools):
    //      Fall back to the text-described tool list + structured-JSON
    //      contract that the agentic loop's tool_use extractor parses.
    //      Used by callers that don't have a (userId, agentId) attribution,
    //      and as a safety net if MCP token issuance fails.
    const useNativeMcp = Boolean(mcpSession && tools && tools.length > 0);

    let toolContext = "";
    let mcpJwt: string | null = null;
    let scopesForJwt: string[] = [];
    let capabilityForJwt: "read" | "write" = "read";
    if (useNativeMcp) {
      // Derive the JWT scopes from the tools the agentic loop already filtered
      // to. The MCP route still gates per-tool by user capability + agent
      // grants, so a wider scope here cannot widen actual access.
      const grantMap = getToolGrantMapping();
      const sideEffectingNames = new Set<string>();
      const requestedScopes = new Set<string>();
      for (const t of tools!) {
        const fn = (t as { function?: { name?: string } }).function;
        const name = fn?.name;
        if (!name) continue;
        const grants = grantMap[name];
        if (grants) {
          for (const g of grants) requestedScopes.add(g);
          if (grants.some(isSideEffectingGrant)) {
            sideEffectingNames.add(name);
          }
        }
      }
      capabilityForJwt = sideEffectingNames.size > 0 ? "write" : "read";
      // Always include backlog_read so the model can situate itself even when
      // its primary task only needs writes; this matches the breadth most
      // existing dpfmcp_* PATs in the install carry.
      requestedScopes.add("backlog_read");
      scopesForJwt = Array.from(requestedScopes).sort();

      try {
        mcpJwt = await createMcpSessionToken({
          userId: mcpSession!.userId,
          agentId: mcpSession!.agentId ?? null,
          threadId: mcpSession!.threadId ?? null,
          routeContext: mcpSession!.routeContext ?? null,
          scopes: scopesForJwt,
          capability: capabilityForJwt,
        });
      } catch (err) {
        // If JWT minting fails (e.g. AUTH_SECRET missing in this env), fall
        // back to legacy mode rather than failing the whole inference call —
        // the build-specialist's existing degraded-mode behavior is at least
        // testable, where a hard fail strands the user mid-conversation.
        console.warn(
          `[cli-adapter] MCP session-token mint failed; falling back to text-tool mode: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        mcpJwt = null;
      }
    }

    if (!mcpJwt && tools && tools.length > 0) {
      // LEGACY-mode tool injection (preserved for callers without mcpSession).
      const toolDescriptions = tools.map((t) => {
        const fn = (t as { type?: string; function?: { name?: string; description?: string; parameters?: unknown } }).function;
        if (fn) {
          return `- ${fn.name}: ${fn.description ?? ""}${fn.parameters ? ` Parameters: ${JSON.stringify(fn.parameters)}` : ""}`;
        }
        return `- ${JSON.stringify(t)}`;
      });
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
    const mcpConfigFile = `/tmp/cli-mcp-${slug}.json`;
    const runnerScript = `/tmp/cli-run-${slug}.sh`;
    // BI-35FAE2DB: empty, per-run cwd so the CLI discovers no project
    // CLAUDE.md / settings / hooks above it.
    const cliWorkingDir = `/tmp/cli-cwd-${slug}`;
    // Records the in-container claude PID so a timeout can reap the actual
    // process inside the sandbox (BI-F36E7510). proc.kill() below only reaches
    // the local `docker exec` client, not the containerized process.
    const pidFile = `/tmp/cli-pid-${slug}.txt`;

    const cp = lazyChildProcess();
    const execAsync = lazyUtil().promisify(cp.exec);
    const spawnCb = cp.spawn;

    try {
      // Write prompt and system prompt to sandbox. Content is streamed via the
      // child's stdin (writeSandboxFile → dockerExecWriteStdin), NOT embedded in
      // the docker exec command — so secrets staged this way (the OAuth token /
      // mcp-config JWT below) never enter argv, a `ps` listing, or an exec log
      // (BI-AFEF038A).
      const writes: Promise<unknown>[] = [
        writeSandboxFile({ containerId: SANDBOX_CONTAINER, path: promptFile, content: prompt, mode: "644", timeoutMs: 5_000 }),
        writeSandboxFile({ containerId: SANDBOX_CONTAINER, path: systemFile, content: fullSystemPrompt, mode: "644", timeoutMs: 5_000 }),
      ];

      if (mcpJwt) {
        // Per-call mcp-config — includes the short-lived JWT in the
        // X-MCP-Session header. File lives only for this call (cleaned in
        // finally) so the JWT cannot leak to subsequent CLI invocations.
        const mcpConfig = {
          mcpServers: {
            dpf: {
              type: "http",
              url: `${INTERNAL_PORTAL_URL}/api/mcp/v1`,
              headers: {
                "X-MCP-Session": mcpJwt,
              },
            },
          },
        };
        writes.push(
          writeSandboxFile({
            containerId: SANDBOX_CONTAINER,
            path: mcpConfigFile,
            content: JSON.stringify(mcpConfig),
            chownNodeUser: true,
            mode: "644",
            timeoutMs: 5_000,
          }),
        );
      }

      await Promise.all(writes);

      // 5. Build auth env and runner script
      let authExportLine: string;
      let bareFlag = "";
      if (auth.mode === "oauth") {
        try {
          await writeSandboxFile({ containerId: SANDBOX_CONTAINER, path: tokenFile, content: auth.token, mode: "644", timeoutMs: 5_000 });
        } catch {
          // BI-1291B677 / BI-AFEF038A: the token now streams via stdin so it no
          // longer enters the command surface, but keep this belt-and-suspenders
          // catch so any failure surfaces a token-free error rather than a raw
          // exec rejection that could carry stderr detail into the dispatch
          // error and the BuildActivity / ideate_dispatch summary.
          throw new Error("Failed to stage the CLI OAuth token into the sandbox.");
        }
        authExportLine = `export CLAUDE_CODE_OAUTH_TOKEN=$(cat ${tokenFile})`;
      } else {
        authExportLine = `export ANTHROPIC_API_KEY=${auth.apiKey}`;
        bareFlag = "--bare ";
      }

      // Build the CLI command.
      //
      // NATIVE-MCP path: --mcp-config + --strict-mcp-config mounts the platform
      // MCP server. Native CLI tools (Read, Bash, etc.) remain disallowed via
      // --disallowedTools so the model cannot pick a Bash workaround over the
      // platform tool intended for the task — the audit doc notes this as the
      // backstop against the BI-931303FF shadowing failure mode.
      //
      // LEGACY path: text-described tool list (toolContext above) + same
      // --disallowedTools. The agentic loop's tool_use extractor parses the
      // model's structured-JSON output as before.
      const cliModel = modelId || "sonnet";
      const mcpFlags = mcpJwt
        ? `--mcp-config ${mcpConfigFile} --strict-mcp-config `
        : "";
      // NOTE: claude is backgrounded (NOT `exec`ed) so the runner sh stays the
      // parent and records claude's PID to pidFile. This lets the timeout path
      // reap the real in-container process tree (BI-F36E7510); `exec` would
      // replace the sh, leaving the cmdline as bare `claude -p ...` with no
      // unique handle and no way to signal it from the host. stdout/stderr are
      // inherited by the background child, so capture is unchanged.
      // BI-35FAE2DB: headless inference runs from a NEUTRAL directory, never
      // the project workspace. `claude` discovers CLAUDE.md (which imports the
      // whole AGENTS.md rulebook), settings and hooks by walking UP from cwd,
      // so `cd /workspace` turned every single-shot call into an agentic
      // session that answered "respond with ONLY a JSON object" with session
      // meta-commentary — unparseable, and the reason design review reported
      // "Both review agents failed to respond" for 332 rounds. Nothing is lost
      // by leaving: every native filesystem tool is already disallowed here
      // (CLAUDE_CODE_NATIVE_TOOLS_FLAG_VALUE), so that context could never be
      // acted on, only paid for. Measurements are in the BI and commit message.
      const script = [
        "#!/bin/sh",
        `mkdir -p ${cliWorkingDir}`,
        `cd ${cliWorkingDir}`,
        authExportLine,
        `SYSPROMPT=$(cat ${systemFile})`,
        `claude ${bareFlag}-p - --dangerously-skip-permissions ${mcpFlags}--disallowedTools "${CLAUDE_CODE_NATIVE_TOOLS_FLAG_VALUE}" --output-format json --model ${cliModel} --system-prompt "$SYSPROMPT" < ${promptFile} &`,
        `CLIPID=$!`,
        `echo "$CLIPID" > ${pidFile}`,
        `wait "$CLIPID"`,
      ].join("\n");

      await writeSandboxFile({ containerId: SANDBOX_CONTAINER, path: runnerScript, content: script, mode: "755", timeoutMs: 5_000 });

      // 6. Spawn the CLI process
      console.log(
        `[cli-adapter] Dispatching to Claude CLI: thread=${mcpSession?.threadId ?? "—"}, model=${cliModel}, provider=${providerId}, ` +
        `messages=${messages.length}, mode=${mcpJwt ? "native-mcp" : "legacy-text-tools"}` +
        (mcpJwt ? `, scopes=${scopesForJwt.length}, capability=${capabilityForJwt}` : ""),
      );

      // Acquire a global CLI slot around the heavy spawn-and-wait: bounds how
      // many `docker exec <sandbox> claude` children run at once across ALL
      // callers (Build Studio + coworkers), so a fan-out can't starve the
      // shared sandbox / portal. Prep (auth, file writes) stays outside the
      // slot so slots turn over on real inference, not setup.
      const { stdout } = await withCliSlot(() => new Promise<{ stdout: string }>((resolve, reject) => {
        const proc = spawnCb("docker", [
          "exec", "--user", "node", SANDBOX_CONTAINER, runnerScript,
        ]);

        let stdout = "";
        let stderr = "";
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          proc.kill("SIGTERM");
          // proc.kill() only signals the local `docker exec` client; the
          // process INSIDE the container is not forwarded the signal and would
          // orphan, pinning the shared sandbox to this build's branch and
          // leaking pids/threads (BI-F36E7510 — the "portal bad state from too
          // many CLIs" symptom). Reap the in-container tree explicitly: SIGTERM
          // the recorded claude PID + the runner sh, then escalate to SIGKILL.
          const reap = (sig: "TERM" | "KILL") =>
            execAsync(
              `docker exec ${SANDBOX_CONTAINER} sh -c "kill -${sig} $(cat ${pidFile} 2>/dev/null) 2>/dev/null; pkill -${sig} -f ${runnerScript} 2>/dev/null; true"`,
              { timeout: 5_000 },
            ).catch(() => {});
          void reap("TERM");
          setTimeout(() => void reap("KILL"), 3_000);
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
            } else if (isProviderOverloadMessage(stderr)) {
              reject(new InferenceError(
                `Claude CLI overloaded: ${stderr.slice(0, 300)}`,
                "overloaded",
                providerId,
              ));
            } else if (stderr.includes("rate") || stderr.includes("429")) {
              // EP-COST Phase 4: record pool exhaustion so orchestrator can back off
              void recordCliRateLimit("claude-cli", providerId, stderr);
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
      }));

      // 7. Parse the output
      const parsed = parseCliJsonOutput(stdout);
      const inferenceMs = Date.now() - startMs;

      console.log(
        `[cli-adapter] Completed: thread=${mcpSession?.threadId ?? "—"}, ${parsed.text.length} chars, ` +
        `${parsed.toolCalls.length} tool calls, ${inferenceMs}ms`,
      );

      // Claude Code CLI returns auth errors on STDOUT with exit=0, not stderr.
      // Observed payloads: "Invalid API key · Fix external API key",
      // "Please log in with /login", "Authentication failed". Without this
      // check the 38-char error string gets shipped as assistant content,
      // the coworker echoes the error verbatim, and fallback never fires
      // because the adapter thinks the call succeeded.
      const CLI_AUTH_ERROR_PATTERNS = [
        /invalid api key/i,
        /fix external api key/i,
        /please log in/i,
        /authentication failed/i,
        /not authenticated/i,
      ];
      const looksLikeAuthError =
        parsed.toolCalls.length === 0 &&
        parsed.text.length < 300 &&
        CLI_AUTH_ERROR_PATTERNS.some((p) => p.test(parsed.text));
      if (looksLikeAuthError) {
        throw new InferenceError(
          `Claude CLI auth error (from stdout): ${parsed.text.slice(0, 200)}`,
          "auth",
          providerId,
        );
      }

      if (parsed.toolCalls.length === 0 && parsed.text.length < 600 && isProviderOverloadMessage(parsed.text)) {
        throw new InferenceError(
          `Claude CLI overloaded (from stdout): ${parsed.text.slice(0, 300)}`,
          "overloaded",
          providerId,
        );
      }

      // Quota exhaustion (BI-QUOTA-DEAD-END). Raised as rate_limit so routing
      // can exclude this provider and fail over, exactly as it does for auth
      // and overload above. Without this branch the banner became the reply.
      if (parsed.toolCalls.length === 0 && isCliQuotaBanner(parsed.text)) {
        throw new InferenceError(
          `Claude CLI usage limit reached (from stdout): ${parsed.text.slice(0, 200)}`,
          "rate_limit",
          providerId,
        );
      }

      // A banner in FRONT of a real answer is a different failure: the reply is
      // good and the prefix is noise. Strip it rather than discarding the turn.
      if (parsed.toolCalls.length > 0 || parsed.text.length >= 600) {
        parsed.text = stripLeadingQuotaBanner(parsed.text);
      }

      // ── Durable tool-call extraction trace (mirrors codex-cli-adapter) ──
      // See note there. Kept on until tool dispatch is 100% reliable.
      //
      // Subtract names the CLI MCP client already executed before we saw the
      // output — when an agent calls mcp__dpf__report_quality_issue via the
      // CLI's MCP layer, then narrates "I filed this issue: { ...args... }",
      // the bare regex sees the tool name in narration and would otherwise
      // log NO-CALL-BUT-MENTIONED even though the call actually fired. This
      // false signal was the root of the misdirected "agent hallucinates
      // tool calls" diagnosis in Phase J D41. See dogfood log.
      const mentionedNames = extractMentionedPlatformToolNames(parsed.text);
      const extractedNames = parsed.toolCalls.map((c) => c.name);
      const ghostMentions = mentionedNames.filter(
        (n) => !parsed.cliPreExecutedNames.includes(n) && !extractedNames.includes(n),
      );
      console.log(
        `[tool-trace] adapter=claude-cli extracted=${parsed.toolCalls.length} ` +
          `cliPreExecuted=${JSON.stringify(parsed.cliPreExecutedNames)} ` +
          `names=${JSON.stringify(extractedNames)} mentioned=${JSON.stringify(mentionedNames)} ` +
          `ghosts=${JSON.stringify(ghostMentions)}`,
      );
      if (parsed.toolCalls.length === 0 && ghostMentions.length > 0) {
        console.log(
          `[tool-trace] adapter=claude-cli NO-CALL-BUT-MENTIONED ghosts=${JSON.stringify(ghostMentions)} raw=${JSON.stringify(parsed.text.slice(0, 8000))}`,
        );
      } else if (parsed.toolCalls.length > 0) {
        console.log(
          `[tool-trace] adapter=claude-cli CALLS-PARSED head=${JSON.stringify(parsed.text.slice(0, 600))}`,
        );
      }

      // EP-COST Phase 4: successful call proves the pool is available — clear any stale exhaustion record.
      void clearCliRateLimit("claude-cli");

      return {
        text: parsed.text,
        toolCalls: parsed.toolCalls,
        usage: parsed.usage,
        inferenceMs,
      };
    } finally {
      // Clean up temp files (fire-and-forget). The mcp-config file carries the
      // short-lived JWT; even though it's already 5-minute capped, we wipe it
      // so a leaked sandbox shell can't dump the bearer from disk after the
      // call returns.
      execAsync(
        `docker exec ${SANDBOX_CONTAINER} sh -c "rm -f ${promptFile} ${systemFile} ${tokenFile} ${mcpConfigFile} ${runnerScript} ${pidFile}; rmdir ${cliWorkingDir} 2>/dev/null || true"`,
        { timeout: 5_000 },
      ).catch(() => {});
    }
  },
};

// ── Auto-register at import time ─────────────────────────────────────────────

registerExecutionAdapter(cliAdapter);
