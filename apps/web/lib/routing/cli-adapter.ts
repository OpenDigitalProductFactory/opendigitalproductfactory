import { assertCliResultSucceeded, isProviderOverloadMessage, stripLeadingQuotaBanner, parseCliTerminalResultMetadata } from "./cli-result-errors";
export { isCliQuotaBanner, stripLeadingQuotaBanner } from "./cli-result-errors";

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

import type { AdapterRequest, AdapterResult, ExecutionAdapterHandler } from "./adapter-types";
import { InferenceError } from "./inference-error";
import { registerExecutionAdapter } from "./execution-adapter-registry";
import { writeSandboxFile } from "@/lib/build/sandbox/agent-cli-runtime";
import { createMcpSessionToken, type McpToolSurface } from "@/lib/mcp/session-token";
import { getToolGrantMapping } from "@/lib/tak/agent-grants";
import { recordCliRateLimit, clearCliRateLimit } from "./cli-pool-status";
import { withCliSlot } from "./cli-concurrency";
import { isSideEffectingGrant } from "./grant-capability";
import { randomUUID } from "node:crypto";
import { canonicalWorkroomToolName } from "@/lib/shared/workroom-tool-aliases";
import { renderOwnedCliRunner, NativeCliExecutionUncertainError } from "./cli-owned-runner";
import { observeCliProcess } from "./cli-process-observation";
import { claudeCredential, resolveClaudeAuth } from "@/lib/executor-drivers/claude/auth";
import { claudeOneShotArgs, parseClaudeResult } from "@/lib/executor-drivers/claude/one-shot";
import { extractMentionedPlatformToolNames } from "@/lib/executor-drivers/tool-trace";
import type { NativeCliDiagnostics } from "../shared/execution-uncertainty";
import { execSandboxCommandLine, spawnSandboxExec } from "@/lib/workroom-runtime/sandbox-exec";


const SANDBOX_CONTAINER = process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1";
const CLI_TIMEOUT_MS = 600_000; // 10 minutes — accumulated Build Studio context (>100K chars) takes longer than 3 min to process

/** Internal portal URL the sandbox uses to reach `/api/mcp/v1`. The standard
 *  self-host docker bridge resolves `portal` to the portal container; override
 *  for non-standard layouts (e.g. host-network setups) via env. */
const INTERNAL_PORTAL_URL = process.env.DPF_INTERNAL_PORTAL_URL ?? "http://portal:3000";

// ─── CLI Adapter ────────────────────────────────────────────────────────────

export const cliAdapter: ExecutionAdapterHandler = {
  type: "claude-cli",

  async execute(request: AdapterRequest): Promise<AdapterResult> {
    const { providerId, modelId, messages, systemPrompt, tools, mcpSession } = request;
    const poolIdentity = request.plan.providerConnectionId ? { providerId, providerConnectionId: request.plan.providerConnectionId } : undefined;
    const startMs = Date.now();

    // 1. Resolve auth through the Claude driver (one resolver for every Claude path).
    const connectionId = request.plan.providerConnectionId;
    const auth = await resolveClaudeAuth(providerId, connectionId
      ? { connectionId, ...(request.plan.providerConnectionVersion ? { expectedExecutionVersion: request.plan.providerConnectionVersion } : {}) }
      : undefined).catch((error: unknown) => {
      throw new InferenceError(error instanceof Error ? error.message : "Claude credentials could not be resolved.", "auth", providerId);
    });

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
    const restricted = mcpSession?.admittedTokenGrantScopes !== undefined;
    if (restricted && (!useNativeMcp || !mcpSession?.taskRunId || !mcpSession.taskExecutionFence)) {
      throw new InferenceError("Restricted MCP session requires its task, fence and tools.", "auth", providerId);
    }

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
      if (!restricted) requestedScopes.add("backlog_read");
      scopesForJwt = [...new Set(restricted ? mcpSession!.admittedTokenGrantScopes : requestedScopes)].sort();
      const toolSurface: McpToolSurface | undefined = restricted ? { version: 1, toolNames: tools!.map(t => {
        const name = (t as { function?: { name?: string } }).function?.name;
        return typeof name === "string" ? canonicalWorkroomToolName(name) : "";
      }) } : undefined;

      try {
        mcpJwt = await createMcpSessionToken({
          userId: mcpSession!.userId,
          agentId: mcpSession!.agentId ?? null,
          threadId: mcpSession!.threadId ?? null,
          routeContext: mcpSession!.routeContext ?? null,
          taskRunId: mcpSession!.taskRunId ?? null,
          taskExecutionFence: mcpSession!.taskExecutionFence,
          scopes: scopesForJwt,
          capability: capabilityForJwt,
          ...(toolSurface ? { toolSurface } : {}),
        });
      } catch (err) {
        if (restricted) throw new InferenceError("Restricted MCP session could not be issued.", "auth", providerId);
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
    const authHome = `/tmp/dpf-claude-auth-${randomUUID()}`;
    const promptFile = `${authHome}/cli-prompt-${slug}.txt`;
    const systemFile = `${authHome}/cli-system-${slug}.txt`;
    const tokenFile = `${authHome}/cli-token-${slug}.txt`;
    const mcpConfigFile = `${authHome}/cli-mcp-${slug}.json`;
    const runnerScript = `${authHome}/cli-run-${slug}.js`;

    let containerDispatchStarted = false;

    try {
      await execSandboxCommandLine(`docker exec ${SANDBOX_CONTAINER} sh -c 'mkdir -p ${authHome} && chmod 700 ${authHome} && chown node:node ${authHome}'`, { timeout: 5_000 });
      // Write prompt and system prompt to sandbox. Content is streamed via the
      // child's stdin (writeSandboxFile → dockerExecWriteStdin), NOT embedded in
      // the docker exec command — so secrets staged this way (the OAuth token /
      // mcp-config JWT below) never enter argv, a `ps` listing, or an exec log
      // (BI-AFEF038A).
      const writes: Promise<unknown>[] = [
        writeSandboxFile({ containerId: SANDBOX_CONTAINER, path: promptFile, content: prompt, mode: "600", chownNodeUser: true, timeoutMs: 5_000 }),
        writeSandboxFile({ containerId: SANDBOX_CONTAINER, path: systemFile, content: fullSystemPrompt, mode: "600", chownNodeUser: true, timeoutMs: 5_000 }),
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
            mode: "600",
            timeoutMs: 5_000,
          }),
        );
      }

      await Promise.all(writes);

      // 5. Build auth env and runner script
      const credential = claudeCredential(auth);
      if (auth.mode === "oauth") {
        try {
          await writeSandboxFile({ containerId: SANDBOX_CONTAINER, path: tokenFile, content: credential.value, chownNodeUser: true, mode: "600", timeoutMs: 5_000 });
        } catch {
          // BI-1291B677 / BI-AFEF038A: the token now streams via stdin so it no
          // longer enters the command surface, but keep this belt-and-suspenders
          // catch so any failure surfaces a token-free error rather than a raw
          // exec rejection that could carry stderr detail into the dispatch
          // error and the BuildActivity / ideate_dispatch summary.
          throw new Error("Failed to stage the CLI OAuth token into the sandbox.");
        }
      } else {
        await writeSandboxFile({ containerId: SANDBOX_CONTAINER, path: tokenFile, content: credential.value, chownNodeUser: true, mode: "600", timeoutMs: 5_000 });
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
      const script = renderOwnedCliRunner({ command: "claude", args: claudeOneShotArgs({ authMode: auth.mode, ...(mcpJwt ? { mcpConfigFile } : {}),
        disallowNativeTools: true, model: cliModel }),
        home: authHome, cwd: authHome, promptFile, systemPromptFile: systemFile, timeoutMs: CLI_TIMEOUT_MS,
        env: { CLAUDE_CONFIG_DIR: authHome }, secretFile: { path: tokenFile, variable: credential.envVar } });

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
      const { stdout, diagnostics } = await withCliSlot(() => new Promise<{ stdout: string; diagnostics: NativeCliDiagnostics }>((resolve, reject) => {
        const proc = spawnSandboxExec([
          "exec", "--user", "node", SANDBOX_CONTAINER, "node", runnerScript,
        ]);
        containerDispatchStarted = true;

        observeCliProcess(proc, {
          timeoutMs: CLI_TIMEOUT_MS + 15_000,
          onClose: ({ code, stdout, stderr, diagnostics: localDiagnostics }) => {
            const diagnostics = { ...localDiagnostics, terminalResult: parseCliTerminalResultMetadata(stdout) };
            if (diagnostics.timedOut || code === null || code === 124 || stderr.includes("DPF_CLI_TIMEOUT")) {
              reject(new NativeCliExecutionUncertainError(providerId, diagnostics));
            } else if (code !== 0 && (mcpJwt || stdout.trim())) {
              reject(new NativeCliExecutionUncertainError(providerId, diagnostics));
            } else if (code === 0) {
              resolve({ stdout, diagnostics });
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
                void recordCliRateLimit("claude-cli", providerId, stderr, poolIdentity);
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
          },
          onError: (err: Error, observation) => {
            if (observation.started) {
              reject(new NativeCliExecutionUncertainError(providerId, observation.diagnostics));
              return;
            }
            containerDispatchStarted = false;
            reject(new InferenceError(
              `Claude CLI spawn error: ${err.message}`,
              "network",
              providerId,
            ));
          },
        });
      }));

      // 7. Parse the output
      if (mcpJwt && diagnostics.terminalResult?.status !== "success") throw new NativeCliExecutionUncertainError(providerId, diagnostics);
      const parsed = parseClaudeResult(stdout);
      const inferenceMs = Date.now() - startMs;

      try {
        assertCliResultSucceeded(stdout, parsed, providerId);
      } catch (error) {
        // Native MCP tools may have run before an error-shaped terminal result.
        if (mcpJwt) throw new NativeCliExecutionUncertainError(providerId, diagnostics);
        if (error instanceof InferenceError && error.code === "rate_limit") {
          // Publish exhaustion before fallback can select another model on the
          // same account. The recorder contains persistence failures itself.
          await recordCliRateLimit("claude-cli", providerId, parsed.text, poolIdentity);
        }
        throw error;
      }
      console.log(
        `[cli-adapter] Completed: thread=${mcpSession?.threadId ?? "—"}, ${parsed.text.length} chars, ` +
        `${parsed.toolCalls.length} tool calls, ${inferenceMs}ms`,
      );

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
      void clearCliRateLimit("claude-cli", poolIdentity);

      return {
        text: parsed.text,
        toolCalls: parsed.toolCalls,
        usage: parsed.usage,
        inferenceMs,
      };
    } catch (error) {
      // Quota is an account observation, not proof that native tool effects settled.
      // Use only the validated terminal envelope, never raw output. A dated
      // phrase in that envelope yields its reset instant (BI-783EBEE6); without
      // one the reset stays unknown rather than guessed.
      const terminal = error instanceof NativeCliExecutionUncertainError ? error.diagnostics?.terminalResult : undefined;
      if (terminal?.type === "result" && terminal.status === "error" && terminal.isError === true && terminal.hint === "quota") {
        const resetAt = terminal.resetAt ? new Date(terminal.resetAt) : null;
        try {
          if (resetAt) await recordCliRateLimit("claude-cli", providerId,
            `The native CLI reported a usage limit that resets at ${resetAt.toISOString()}.`, poolIdentity, resetAt);
          else await recordCliRateLimit("claude-cli", providerId,
            "The native CLI reported a usage limit; its reset time is unknown.", poolIdentity);
        } catch { /* Persistence must never replace the original execution hold. */ }
      }
      throw error;
    } finally {
      // Clean up temp files (fire-and-forget). The mcp-config file carries the
      // short-lived JWT; even though it's already 5-minute capped, we wipe it
      // so a leaked sandbox shell can't dump the bearer from disk after the
      // call returns.
      if (!containerDispatchStarted) await execSandboxCommandLine(
        `docker exec ${SANDBOX_CONTAINER} sh -c 'rm -rf ${authHome}'`, { timeout: 5_000 },
      ).catch(() => {});
    }
  },
};

// ── Auto-register at import time ─────────────────────────────────────────────

registerExecutionAdapter(cliAdapter);
