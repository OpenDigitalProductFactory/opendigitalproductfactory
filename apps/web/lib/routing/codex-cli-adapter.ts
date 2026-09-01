// apps/web/lib/routing/codex-cli-adapter.ts

/**
 * Codex CLI execution adapter for codex (OpenAI subscription OAuth) users.
 *
 * OAuth subscription tokens are NOT supported via direct HTTP calls to the
 * ChatGPT backend (chatgpt.com/backend-api) — the backend requires session
 * auth that only the Codex CLI binary provides. This adapter routes inference
 * through `codex exec` in the sandbox container, mirroring the pattern used
 * for anthropic-sub → claude-cli adapter.
 *
 * Auth is injected via ~/.codex/auth.json (same as codex-dispatch.ts for
 * build tasks). The Codex CLI handles its own HTTP layer and auth format.
 *
 * For API key auth, the OPENAI_API_KEY env var is used instead.
 */

import type { AdapterRequest, AdapterResult, ExecutionAdapterHandler, ToolCallEntry } from "./adapter-types";
import { InferenceError } from "@/lib/ai-inference";
import { getDecryptedCredential, getProviderBearerToken } from "@/lib/inference/ai-provider-internals";
import { registerExecutionAdapter } from "./execution-adapter-registry";
import { lazyChildProcess, lazyUtil } from "@/lib/shared/lazy-node";
import { extractToolCalls as sharedExtractToolCalls } from "./extract-tool-calls";
import { recordCliRateLimit, clearCliRateLimit } from "./cli-pool-status";
import { withCliSlot } from "./cli-concurrency";

const SANDBOX_CONTAINER = process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1";
const CLI_TIMEOUT_MS = 600_000; // 10 minutes — accumulated Build Studio context (>100K chars) takes longer than 3 min to process

/**
 * Auth/login failure signatures from the Codex CLI. Checked BEFORE rate-limit
 * classification (routing-resilience spec D2): when an OAuth token has expired
 * the CLI sometimes emits throttle-looking text, and misclassifying that as
 * `rate_limit` sends the fallback chain into a 30s wait-and-retry loop against
 * a provider that cannot succeed until re-authentication. Treating it as `auth`
 * disables the provider and surfaces the reconnect action instead.
 */
const CLI_AUTH_FAILURE_PATTERNS: RegExp[] = [
  /not logged in/i,
  /unauthorized/i,
  /\b401\b/,
  /re-?authenticat/i,
  /please log ?in/i,
  /session (?:has )?expired/i,
  /token (?:has )?expired/i,
  /not authenticated/i,
  /invalid api key/i,
  /fix external api key/i,
];

export function looksLikeCliAuthFailure(text: string): boolean {
  return CLI_AUTH_FAILURE_PATTERNS.some((p) => p.test(text));
}

/**
 * Genuine Codex CLI capacity-exhaustion signatures.
 *
 * Do not use broad fragments such as `text.includes("rate")`: ordinary error
 * prose can contain words like "degrade performance", which previously turned
 * an unsupported-model HTTP 400 into a false rate-limit and poisoned the whole
 * CLI pool. These signatures are intentionally tied to explicit HTTP throttle,
 * quota, or usage-limit language.
 */
const CLI_RATE_LIMIT_PATTERNS: RegExp[] = [
  /\b429\b/,
  /too many requests/i,
  /rate[_ -]?limit(?:ed| exceeded| reached)?/i,
  /(?:weekly|usage|quota) limit (?:has been )?(?:reached|exceeded)/i,
  /you(?:'|’)ve hit your (?:weekly|usage|quota) limit/i,
];

export function looksLikeCliRateLimit(text: string): boolean {
  return CLI_RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(text));
}

// ─── Container file writer ─────────────────────────────────────────────────

/**
 * Write base64-encoded data to a file inside the sandbox container via stdin.
 *
 * Root cause fix for BI-2685C1E5: the old approach —
 *   docker exec CONTAINER sh -c "echo '${largeB64}' | base64 -d > file"
 * — passes the entire base64 payload as a shell argument inside the `sh -c`
 * string, which itself is an argument to `docker exec`. On Linux the combined
 * size of all arguments + the environment must stay below ARG_MAX (~2 MB).
 * With 58+ tools each carrying full JSON parameter schemas the base64-encoded
 * prompt easily exceeds that limit and the OS rejects the spawn with POSIX
 * E2BIG ("Argument list too long").
 *
 * Piping through stdin is unlimited in size. `docker exec -i` connects the
 * host's stdin to the container's stdin; `base64 -d` reads from stdin when no
 * file argument is given. The command line for `docker exec` stays short
 * regardless of payload size.
 */
export async function writeContainerFileViaStdin(
  b64Data: string,
  destPath: string,
  mode = "644",
): Promise<void> {
  const spawn = lazyChildProcess().spawn;
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      "docker",
      ["exec", "-i", SANDBOX_CONTAINER, "sh", "-c", `base64 -d > ${destPath} && chmod ${mode} ${destPath}`],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    let stderr = "";
    let settled = false;
    const settle = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(writeTimeout); fn(); } };

    // 10 s is generous for any realistic payload over a loopback socket.
    const writeTimeout = setTimeout(() => {
      proc.kill("SIGTERM");
      settle(() => reject(new Error(`Container file write timed out: ${destPath}`)));
    }, 10_000);

    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

    proc.stdin!.write(b64Data, (writeErr) => {
      if (writeErr) settle(() => reject(new Error(`Container file write stdin error: ${writeErr.message}`)));
    });
    proc.stdin!.end();

    proc.on("close", (code: number | null) => {
      settle(() => {
        if (code === 0) resolve();
        else reject(new Error(`Container file write failed (exit ${code ?? "?"}): ${stderr.slice(0, 200)}`));
      });
    });

    proc.on("error", (err: Error) => {
      settle(() => reject(err));
    });
  });
}

export const TOOL_TRACE_KEYWORD_PATTERN = /\b(read_sandbox_file|write_sandbox_file|edit_sandbox_file|search_sandbox|list_sandbox_files|run_sandbox_command|check_sandbox|start_sandbox|saveBuildEvidence|save_build_notes|save_phase_handoff|reviewDesignDoc|reviewBuildPlan|search_project_files|read_project_file|list_project_directory|get_code_graph_freshness|inspect_build_code_impact|search_code_graph|trace_code_surface|find_related_tests|generate_design_system|search_design_intelligence|describe_model|deploy_feature|execute_promotion)\b/g;

export function extractMentionedPlatformToolNames(text: string): string[] {
  return Array.from(new Set(text.match(TOOL_TRACE_KEYWORD_PATTERN) ?? []));
}

// ─── Auth injection ────────────────────────────────────────────────────────

/**
 * Inject Codex CLI auth into the sandbox container.
 * Mirrors the auth injection from codex-dispatch.ts:injectCodexAuth.
 *
 * The Codex CLI expects ~/.codex/auth.json with:
 * - auth_mode: "chatgptAuthTokens" (use tokens as-is, no browser refresh)
 * - tokens.access_token: the OAuth access token
 * - tokens.id_token: a JWT (same as access_token if JWT, or synthetic)
 */
async function injectAuth(providerId: string): Promise<{ mode: "oauth" } | { mode: "apikey"; apiKey: string }> {
  const credential = await getDecryptedCredential(providerId);
  if (!credential) {
    throw new InferenceError(
      `No credential for "${providerId}". Configure via Admin > AI Workforce > External Services.`,
      "auth",
      providerId,
    );
  }

  // API key mode — use OPENAI_API_KEY env var
  if (credential.secretRef && !credential.cachedToken) {
    return { mode: "apikey", apiKey: credential.secretRef };
  }

  // OAuth mode — inject auth.json
  // Use getProviderBearerToken which handles token refresh automatically.
  const tokenResult = await getProviderBearerToken(providerId);
  if ("error" in tokenResult) {
    throw new InferenceError(
      `OAuth token error for "${providerId}": ${tokenResult.error}. Re-authenticate via Admin > AI Workforce > External Services.`,
      "auth",
      providerId,
    );
  }

  const accessToken = tokenResult.token;
  const isJwt = accessToken.split(".").length === 3;
  const idToken = isJwt
    ? accessToken
    : Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url")
      + "." + Buffer.from('{"sub":"dpf"}').toString("base64url")
      + ".";

  const authJson = JSON.stringify({
    auth_mode: "chatgptAuthTokens",
    tokens: {
      access_token: accessToken,
      refresh_token: credential.refreshToken ?? "",
      id_token: idToken,
      account_id: null,
    },
    last_refresh: new Date().toISOString(),
  });

  const execAsync = lazyUtil().promisify(lazyChildProcess().exec);
  // mkdir is a tiny command — safe to run via execAsync.
  await execAsync(`docker exec ${SANDBOX_CONTAINER} mkdir -p /root/.codex`, { timeout: 5_000 });
  const authB64 = Buffer.from(authJson).toString("base64");
  await writeContainerFileViaStdin(authB64, "/root/.codex/auth.json");

  return { mode: "oauth" };
}

// ─── Codex CLI adapter ─────────────────────────────────────────────────────

export const codexCliAdapter: ExecutionAdapterHandler = {
  type: "codex-cli",

  async execute(request: AdapterRequest): Promise<AdapterResult> {
    const { providerId, modelId, messages, systemPrompt, tools } = request;
    const startMs = Date.now();

    // 1. Inject auth
    const auth = await injectAuth(providerId);

    // 2. Build prompt from messages
    const promptParts: string[] = [];
    if (systemPrompt) {
      promptParts.push(systemPrompt);
      promptParts.push("---");
    }
    for (const msg of messages) {
      if (msg.role === "system") continue;
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

    // Add tool definitions to prompt context.
    // The format spec is deliberately explicit so the model emits JSON the
    // extractor below can actually parse — the model otherwise invents
    // variants (XML-ish wrappers, {tool, arguments} key shape, markdown
    // code fences) which silently fail tool dispatch and force the agent
    // to "explain" it couldn't find the tool.
    if (tools && tools.length > 0) {
      const toolDescriptions = tools.map((t) => {
        const fn = (t as { type?: string; function?: { name?: string; description?: string; parameters?: unknown } }).function;
        if (fn) {
          return `- ${fn.name}: ${fn.description ?? ""}${fn.parameters ? ` Parameters: ${JSON.stringify(fn.parameters)}` : ""}`;
        }
        return `- ${JSON.stringify(t)}`;
      });
      promptParts.push(
        `\nAvailable tools. To invoke a tool, output ONE JSON object per invocation ` +
        `using exactly this shape:\n` +
        `{"type":"tool_use","id":"<unique_id>","name":"<tool_name>","input":{<args>}}\n` +
        `Do NOT wrap in XML tags, markdown fences, or rename the keys. ` +
        `When invoking a tool, output only the JSON (no surrounding prose).\n\n` +
        `Tools:\n${toolDescriptions.join("\n")}`,
      );
    }

    const prompt = promptParts.join("\n\n");

    // 3. Write prompt to temp file in sandbox
    const slug = `codex-conv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const promptFile = `/tmp/${slug}-prompt.txt`;
    const runnerScript = `/tmp/${slug}-run.sh`;
    // Records the in-container codex PID so a timeout can reap the actual
    // process inside the sandbox (BI-F36E7510). proc.kill() below only reaches
    // the local `docker exec` client, not the containerized process.
    const pidFile = `/tmp/${slug}-pid.txt`;

    const cp = lazyChildProcess();
    const execAsync = lazyUtil().promisify(cp.exec);
    const spawnCb = cp.spawn;

    try {
      // Write prompt via stdin to avoid the POSIX ARG_MAX limit (BI-2685C1E5).
      // See writeContainerFileViaStdin for full rationale.
      const promptB64 = Buffer.from(prompt).toString("base64");
      await writeContainerFileViaStdin(promptB64, promptFile);

      // 4. Build runner script
      const modelFlag = modelId ? `-m ${modelId}` : "";
      let authExportLine: string;
      if (auth.mode === "apikey") {
        authExportLine = `export OPENAI_API_KEY=${auth.apiKey}`;
      } else {
        // OAuth mode — auth.json already injected
        authExportLine = "# OAuth auth via ~/.codex/auth.json";
      }

      // codex is backgrounded (NOT `exec`ed) so the runner sh stays the parent
      // and records codex's PID to pidFile — letting the timeout path reap the
      // real in-container process tree (BI-F36E7510). stdout/stderr are
      // inherited by the background child, so capture is unchanged.
      const script = [
        "#!/bin/sh",
        "cd /workspace",
        authExportLine,
        `codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check ${modelFlag} < ${promptFile} &`,
        `CLIPID=$!`,
        `echo "$CLIPID" > ${pidFile}`,
        `wait "$CLIPID"`,
      ].join("\n");

      const scriptB64 = Buffer.from(script).toString("base64");
      await writeContainerFileViaStdin(scriptB64, runnerScript, "755");

      // 5. Spawn the CLI process
      console.log(`[codex-cli-adapter] Dispatching: thread=${request.mcpSession?.threadId ?? "—"}, model=${modelId}, provider=${providerId}, messages=${messages.length}`);
      console.log(`[tool-trace] adapter=codex-cli PROMPT-FILE ${promptFile} slug=${slug} promptChars=${prompt.length}`);

      // Preserve prompt to a durable location BEFORE spawning codex so we
      // can inspect what hung if the process times out and the finally
      // block cleans up the regular temp file. Keep the last 20 to bound
      // disk use.
      await execAsync(
        `docker exec ${SANDBOX_CONTAINER} sh -c 'mkdir -p /tmp/codex-dispatch-archive && cp ${promptFile} /tmp/codex-dispatch-archive/${slug}.txt && ls -1t /tmp/codex-dispatch-archive/*.txt 2>/dev/null | tail -n +21 | xargs -r rm -f'`,
        { timeout: 5_000 },
      ).catch(() => {});

      // Acquire a global CLI slot around the heavy spawn-and-wait: this bounds
      // how many `docker exec <sandbox> codex` children run at once across ALL
      // callers (Build Studio + coworkers), so a fan-out can't starve the
      // shared sandbox / portal. Auth + file writes above are cheap and stay
      // outside the slot so slots turn over on real inference, not prep.
      const { stdout } = await withCliSlot(() => new Promise<{ stdout: string }>((resolve, reject) => {
        const proc = spawnCb("docker", [
          "exec", SANDBOX_CONTAINER, runnerScript,
        ]);

        let stdout = "";
        let stderr = "";
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          proc.kill("SIGTERM");
          // proc.kill() only signals the local `docker exec` client; the
          // containerized process is not forwarded the signal and would orphan,
          // pinning the shared sandbox and leaking pids/threads (BI-F36E7510).
          // Reap the in-container tree explicitly, escalating to SIGKILL.
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
              `Codex CLI timed out after ${CLI_TIMEOUT_MS / 1000}s`,
              "provider_error",
              providerId,
            ));
          } else if (code === 0 || stdout.trim()) {
            resolve({ stdout });
          } else {
            if (looksLikeCliAuthFailure(stderr)) {
              reject(new InferenceError(
                `Codex CLI auth failed: ${stderr.slice(0, 300)}`,
                "auth",
                providerId,
              ));
            } else if (looksLikeCliRateLimit(stderr)) {
              // EP-COST Phase 4: record pool exhaustion so orchestrator can back off
              void recordCliRateLimit("codex-cli", providerId, stderr);
              reject(new InferenceError(
                `Codex CLI rate limited: ${stderr.slice(0, 300)}`,
                "rate_limit",
                providerId,
              ));
            } else {
              reject(new InferenceError(
                `Codex CLI exit code ${code}: ${stderr.slice(0, 500)}`,
                "provider_error",
                providerId,
              ));
            }
          }
        });

        proc.on("error", (err: Error) => {
          clearTimeout(timer);
          // E2BIG / ENOMEM: combined arg+env exceeded OS ARG_MAX.
          // After the stdin-pipe fix this should not occur for prompt writes,
          // but classify correctly if it ever does so the fallback chain can
          // skip this provider rather than retrying a doomed request.
          const isArgTooLong =
            /E2BIG|ENOMEM/i.test(err.message) ||
            /argument.*too.*long/i.test(err.message);
          reject(new InferenceError(
            `Codex CLI spawn error: ${err.message}`,
            isArgTooLong ? "request_too_large" : "network",
            providerId,
          ));
        });
      }));

      // 6. Parse output — codex exec returns plain text (no structured JSON)
      const text = stdout.trim();
      const inferenceMs = Date.now() - startMs;

      console.log(
        `[codex-cli-adapter] Completed: thread=${request.mcpSession?.threadId ?? "—"}, ${text.length} chars, ${inferenceMs}ms`,
      );

      // Attempt to extract tool calls if the model responded with tool_use blocks
      const toolCalls = extractToolCalls(text);

      // Codex CLI can emit short auth-failure messages on stdout with exit=0
      // (observed payloads: "Invalid API key · Fix external API key",
      // "ERROR: unexpected status 401 Unauthorized: Missing bearer..."). The
      // stderr-keyword check earlier only catches stderr; mirror that logic
      // on stdout (shared matcher, spec D2) to ensure fallback kicks in instead
      // of the error text being shipped as assistant content.
      const looksLikeAuthError =
        toolCalls.length === 0 &&
        text.length < 300 &&
        looksLikeCliAuthFailure(text);
      if (looksLikeAuthError) {
        throw new InferenceError(
          `Codex CLI auth error (from stdout): ${text.slice(0, 200)}`,
          "auth",
          providerId,
        );
      }

      // ── Durable tool-call extraction trace ────────────────────────────
      // Every codex response is logged under a single `[tool-trace]` prefix
      // so we can see the full extraction path end-to-end: raw output, which
      // tool-name keywords the text mentions, and what the parser returned.
      // Kept on until tool dispatch is 100% reliable — when it is, this can
      // be gated behind a DEBUG_TOOL_TRACE env flag rather than removed
      // outright. Meanwhile every stuck-agent incident produces the exact
      // data needed to tell "model emitted an unrecognized shape" from
      // "model hallucinated a tool call it never emitted".
      const mentionedNames = extractMentionedPlatformToolNames(text);
      const extractedNames = toolCalls.map((c) => c.name);
      // Names mentioned in narration ARE a real signal when the parser
      // returned them too (the agent did call the tool and also discussed
      // it). Exclude those from "ghosts" so the NO-CALL-BUT-MENTIONED
      // signature only fires when the agent talked about a tool the parser
      // never extracted — the actual stuck-agent shape.
      const ghostMentions = mentionedNames.filter((n) => !extractedNames.includes(n));
      console.log(
        `[tool-trace] extracted=${toolCalls.length} names=${JSON.stringify(extractedNames)} mentioned=${JSON.stringify(mentionedNames)} ghosts=${JSON.stringify(ghostMentions)}`,
      );

      // Full dump on the diagnostically-interesting mismatches: the text
      // references a tool name but the parser returned nothing AND the
      // mention isn't accounted for by another extracted call. This is the
      // classic "stuck agent" signature. 8k chars covers any realistic
      // codex response.
      if (toolCalls.length === 0 && ghostMentions.length > 0) {
        console.log(
          `[tool-trace] NO-CALL-BUT-MENTIONED ghosts=${JSON.stringify(ghostMentions)} raw=${JSON.stringify(text.slice(0, 8000))}`,
        );
      } else if (toolCalls.length > 0) {
        // Also log a compact head of the raw text when calls DID parse —
        // lets us correlate "the model meant to call N things and we got N-1"
        // style bugs without the full dump every turn.
        console.log(
          `[tool-trace] CALLS-PARSED head=${JSON.stringify(text.slice(0, 600))}`,
        );
      }

      // EP-COST Phase 4: successful call proves the pool is available — clear any stale exhaustion record.
      void clearCliRateLimit("codex-cli");

      return {
        text: toolCalls.length > 0 ? text.replace(/```json\n?\{[\s\S]*?```/g, "").trim() : text,
        toolCalls,
        usage: { inputTokens: 0, outputTokens: 0 }, // CLI doesn't report usage
        inferenceMs,
      };
    } finally {
      // Clean up temp files (fire-and-forget)
      execAsync(
        `docker exec ${SANDBOX_CONTAINER} sh -c "rm -f ${promptFile} ${runnerScript} ${pidFile}"`,
        { timeout: 5_000 },
      ).catch(() => {});
    }
  },
};

/**
 * Thin wrapper re-export so the unit test file continues to work without
 * being rewritten. The actual logic lives in extract-tool-calls.ts so both
 * codex-cli and claude cli-adapter can use it.
 */
export function extractToolCalls(text: string): ToolCallEntry[] {
  return sharedExtractToolCalls(text);
}

// ── Auto-register at import time ─────────────────────────────────────────────

registerExecutionAdapter(codexCliAdapter);
