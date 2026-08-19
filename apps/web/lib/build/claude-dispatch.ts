// apps/web/lib/build/claude-dispatch.ts
// Dispatch build tasks to Claude Code CLI running inside the sandbox container.
//
// Mirrors codex-dispatch.ts exactly but for Anthropic's Claude Code CLI.
// Supports two auth modes:
//   "oauth" (default) — Claude Max subscription. Flat-rate billing, ~20x more
//     economical than API keys. Uses CLAUDE_CODE_OAUTH_TOKEN env var.
//   "apikey" — Standard Anthropic API key. Per-token billing ($100 burns in hours).
//     Uses ANTHROPIC_API_KEY env var. Only use for testing or when Max is unavailable.
//
// Set CLAUDE_CODE_AUTH_MODE=oauth|apikey to choose. Default: oauth.
// Credential store providerId: "claude-code" (both modes read from the same entry).

import type { AssignedTask } from "./task-dependency-graph";
import {
  SANDBOX_CONTAINER,
  buildSpecialistInstructions,
  buildSpecialistTaskPrompt,
  ensureSandboxNodeUser,
  runSandboxAgentCli,
  writeSandboxFile,
} from "./sandbox/agent-cli-runtime";
import { getDecryptedCredential, getProviderBearerToken } from "@/lib/inference/ai-provider-internals";
import { resolveBuildWorkdir } from "./sandbox/build-branch";

// Timeout per task. Data-architect tasks need more time for schema design.
const CLAUDE_TASK_TIMEOUT_MS = 900_000;        // 15 minutes default
const CLAUDE_SCHEMA_TASK_TIMEOUT_MS = 1_200_000; // 20 minutes for schema tasks

export type ClaudeResult = {
  content: string;       // Claude's response text
  success: boolean;
  executedTools: Array<{ name: string; args: unknown; result: { success: boolean } }>;
  durationMs: number;
  sessionId?: string;    // Claude Code session ID (for session continuity across tasks)
  // BI-89030C9B Phase 1 ($/build): the --output-format json envelope already
  // carries cost + token usage; capture instead of discarding. Especially
  // material since headless Claude Code bills per-token against a metered
  // credit pool (spec §9.3) — a build is real spend now.
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
};

/**
 * Auth credentials resolved from the credential store.
 *
 * OAuth mode (Max Plan): flat-rate subscription, ~20x cheaper than API keys
 *   for sustained build workloads. Injects CLAUDE_CODE_OAUTH_TOKEN env var.
 * API key mode: per-token billing via ANTHROPIC_API_KEY. Burns fast —
 *   $100 in a few hours vs. 5+ days on Max Plan.
 */
type ClaudeAuth =
  | { mode: "oauth"; tokenJson: string }  // raw access token string (sk-ant-oat01-...)
  | { mode: "apikey"; apiKey: string };

async function resolveClaudeAuth(providerId: string): Promise<ClaudeAuth> {
  // Auth mode is implicit in the provider ID:
  //   "anthropic-sub" → OAuth (Max Plan subscription, flat-rate)
  //   "anthropic"     → API key (per-token billing)
  const isOAuth = providerId === "anthropic-sub";

  if (!isOAuth) {
    const credential = await getDecryptedCredential(providerId);
    const apiKey = credential?.secretRef ?? credential?.cachedToken;
    if (!apiKey) {
      throw new Error(`No Anthropic API key for provider "${providerId}". Configure via Admin > AI Workforce > External Services.`);
    }
    return { mode: "apikey", apiKey };
  }

  // OAuth: use getProviderBearerToken which checks tokenExpiresAt and refreshes
  // automatically when the access token has expired. Access tokens expire every
  // few hours; using getDecryptedCredential directly would send an expired token
  // causing 401. CLAUDE_CODE_OAUTH_TOKEN takes the raw sk-ant-oat01-... string.
  const result = await getProviderBearerToken(providerId);
  if ("error" in result) {
    throw new Error(`OAuth token refresh failed for "${providerId}": ${result.error}. Re-authenticate via Admin > AI Providers > Anthropic Subscription.`);
  }
  return { mode: "oauth", tokenJson: result.token };
}

/**
 * Dispatch a single build task to Claude Code CLI inside the sandbox container.
 *
 * Auth modes (set CLAUDE_CODE_AUTH_MODE env var):
 *   "oauth" (default) — Max Plan subscription. Flat-rate, ~20x cheaper for builds.
 *   "apikey" — Per-token API billing. Fast to set up, expensive at scale.
 *
 * Flow:
 * 1. Resolve auth from portal credential store (OAuth token or API key)
 * 2. Write prompt to a temp file in the sandbox (avoids shell escaping issues)
 * 3. Inject auth env var + run: claude --bare -p - --dangerously-skip-permissions --output-format json
 * 4. Parse JSON output, extract .result field for content
 */
export async function dispatchClaudeTask(params: {
  task: AssignedTask;
  buildId: string;
  buildContext: string;
  priorResults?: string;
  providerId?: string;
  model?: string;
  sessionId?: string;   // Reuse a Claude Code session for cross-task context continuity
  onProgress?: (message: string) => void;
}): Promise<ClaudeResult> {
  const { task, buildContext, priorResults } = params;
  const providerId = params.providerId ?? "anthropic-sub";
  const model = params.model ?? "sonnet";
  const sessionId = params.sessionId;
  const role = task.specialist;
  // Per-build working dir: the build's worktree when isolation is ON, else
  // /workspace (default — byte-identical). Container ops stay container-rooted.
  const workdir = resolveBuildWorkdir(params.buildId);

  // Resolve auth credentials (OAuth for Max Plan, or API key for per-token billing)
  let auth: ClaudeAuth;
  try {
    auth = await resolveClaudeAuth(providerId);
  } catch (err) {
    return {
      content: `Auth error: ${(err as Error).message}`,
      success: false,
      executedTools: [],
      durationMs: 0,
    };
  }

  const instructions = buildSpecialistInstructions({ role, buildContext, priorResults });
  const taskPrompt = buildSpecialistTaskPrompt({ task, instructions });

  const startMs = Date.now();
  // Use task-specific temp files to avoid collisions during parallel execution.
  const taskSlug = task.title.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 40).toLowerCase();
  const promptFile = `/tmp/claude-prompt-${taskSlug}.txt`;
  const tokenFile = `/tmp/claude-token-${taskSlug}.txt`;

  try {
    // Ensure /workspace is writable by the node user (uid 1000). Files may be
    // root-owned from bootstrap or prior Codex runs. Claude Code CLI must run as
    // non-root (--dangerously-skip-permissions refuses root).
    await ensureSandboxNodeUser(SANDBOX_CONTAINER);

    // Write prompt to a task-specific temp file in the sandbox (avoids shell
    // escaping AND prevents parallel tasks from overwriting each other's
    // prompts). 644 so the non-root node user can read it.
    await writeSandboxFile({ containerId: SANDBOX_CONTAINER, path: promptFile, content: taskPrompt, mode: "644" });

    // Inject auth credentials into the sandbox container, then assemble the
    // runner script (avoids shell quoting issues with $(cat ...) in busybox ash).
    let authExportLine: string;
    let useBareflag: boolean;
    if (auth.mode === "oauth") {
      // OAuth (Max Plan): write raw token to task-specific temp file (644).
      await writeSandboxFile({ containerId: SANDBOX_CONTAINER, path: tokenFile, content: auth.tokenJson, mode: "644" });
      authExportLine = `export CLAUDE_CODE_OAUTH_TOKEN=$(cat ${tokenFile})`;
      useBareflag = false;  // --bare disables OAuth
    } else {
      // API key mode
      authExportLine = `export ANTHROPIC_API_KEY=${auth.apiKey}`;
      useBareflag = true;   // --bare is safe with API key
    }

    const modeLabel = auth.mode === "oauth" ? "Max Plan (OAuth)" : "API key (per-token)";
    const bareFlag = useBareflag ? "--bare " : "";
    const sessionFlag = sessionId ? `--session-id ${sessionId} ` : "";
    const timeoutMs = role === "data-architect" ? CLAUDE_SCHEMA_TASK_TIMEOUT_MS : CLAUDE_TASK_TIMEOUT_MS;

    const runnerScript = `/tmp/claude-run-${taskSlug}.sh`;
    const script = [
      "#!/bin/sh",
      `cd ${workdir}`,
      authExportLine,
      `exec claude ${bareFlag}${sessionFlag}-p - --dangerously-skip-permissions --output-format json --model ${model} < ${promptFile}`,
    ].join("\n");
    await writeSandboxFile({ containerId: SANDBOX_CONTAINER, path: runnerScript, content: script, mode: "755" });

    console.log(`[claude-dispatch] Starting task "${task.title}" with ${model} [${modeLabel}]${sessionId ? ` [session: ${sessionId}]` : ""} in ${SANDBOX_CONTAINER} (timeout: ${timeoutMs / 1000}s)`);

    // Shared spawn-docker-exec loop (runs as node; streams stderr for progress).
    const { stdout, durationMs: elapsed } = await runSandboxAgentCli({
      containerId: SANDBOX_CONTAINER,
      runnerScript,
      timeoutMs,
      asNodeUser: true,
      onStderrLine: (line) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("Reading file:")) {
          params.onProgress?.(`Reading ${trimmed.replace("Reading file: ", "")}`);
        } else if (trimmed.startsWith("Writing file:") || trimmed.startsWith("Creating file:")) {
          params.onProgress?.(`Creating ${trimmed.replace(/^(Writing|Creating) file: /, "")}`);
        } else if (trimmed.startsWith("Editing file:")) {
          params.onProgress?.(`Editing ${trimmed.replace("Editing file: ", "")}`);
        } else if (trimmed.startsWith("Running bash command:") || trimmed.startsWith("Running command:")) {
          params.onProgress?.(`Running: ${trimmed.replace(/^Running( bash)? command: /, "").slice(0, 80)}`);
        } else if (trimmed === "Thinking...") {
          params.onProgress?.("Thinking...");
        }
      },
    });

    // Parse JSON output — Claude Code --output-format json returns
    // { result, session_id, total_cost_usd, usage, ... }
    let content: string;
    let returnedSessionId: string | undefined;
    let costUsd: number | undefined;
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    try {
      const parsed = JSON.parse(stdout.trim());
      content = typeof parsed.result === "string" ? parsed.result : JSON.stringify(parsed.result);
      returnedSessionId = parsed.session_id ?? undefined;
      // BI-89030C9B Phase 1 ($/build): keep the cost/usage fields the envelope
      // already returns instead of discarding them.
      costUsd = typeof parsed.total_cost_usd === "number" ? parsed.total_cost_usd : undefined;
      const usage = parsed.usage as
        | { input_tokens?: number; output_tokens?: number }
        | undefined;
      inputTokens = typeof usage?.input_tokens === "number" ? usage.input_tokens : undefined;
      outputTokens = typeof usage?.output_tokens === "number" ? usage.output_tokens : undefined;
    } catch {
      content = stdout.trim();
    }

    console.log(`[claude-dispatch] Task "${task.title}" completed in ${(elapsed / 1000).toFixed(1)}s (${content.length} chars)${returnedSessionId ? ` [session: ${returnedSessionId}]` : ""}${costUsd != null ? ` [cost: $${costUsd.toFixed(4)}, tokens ${inputTokens ?? "?"}in/${outputTokens ?? "?"}out]` : ""}`);

    return {
      content: content || "Task completed with no output.",
      success: true,
      executedTools: [],
      durationMs: elapsed,
      sessionId: returnedSessionId,
      costUsd,
      inputTokens,
      outputTokens,
    };
  } catch (err) {
    const durationMs = Date.now() - startMs;
    const execErr = err as { stdout?: string; stderr?: string; message?: string; code?: number; killed?: boolean };
    const output = (execErr.stdout ?? "") + "\n" + (execErr.stderr ?? "");

    if (execErr.killed) {
      console.warn(`[claude-dispatch] Task "${task.title}" killed after ${CLAUDE_TASK_TIMEOUT_MS / 1000}s timeout`);
      return {
        content: `Task timed out after ${CLAUDE_TASK_TIMEOUT_MS / 1000}s. Partial output:\n${output.slice(-2000)}`,
        success: false,
        executedTools: [],
        durationMs,
      };
    }

    if (output.trim()) {
      console.log(`[claude-dispatch] Task "${task.title}" exited with code ${execErr.code}. Output: ${output.slice(0, 200)}`);
      return {
        content: output.trim().slice(-5000),
        success: execErr.code === 0,
        executedTools: [],
        durationMs,
      };
    }

    console.error(`[claude-dispatch] Task "${task.title}" failed: ${execErr.message?.slice(0, 200)}`);
    return {
      content: `Claude Code CLI error: ${execErr.message?.slice(0, 1000) ?? "Unknown error"}`,
      success: false,
      executedTools: [],
      durationMs,
    };
  }
}
