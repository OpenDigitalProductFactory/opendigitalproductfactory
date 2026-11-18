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
  credentialFileExports,
  ensureSandboxNodeUser,
  removeSandboxFiles,
  runSandboxAgentCli,
  writeSandboxFile,
} from "./sandbox/agent-cli-runtime";
import { claudeCredential, resolveClaudeAuth, type ClaudeAuth } from "@/lib/executor-drivers/claude/auth";
import { claudeOneShotArgs, parseClaudeResult } from "@/lib/executor-drivers/claude/one-shot";
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
 * Dispatch a single build task to Claude Code CLI inside the sandbox container.
 *
 * Auth modes (set CLAUDE_CODE_AUTH_MODE env var):
 *   "oauth" (default) — Max Plan subscription. Flat-rate, ~20x cheaper for builds.
 *   "apikey" — Per-token API billing. Fast to set up, expensive at scale.
 *
 * Flow:
 * 1. Resolve auth from portal credential store (OAuth token or API key)
 * 2. Write prompt to a temp file in the sandbox (avoids shell escaping issues)
 * 3. Write the credential to a 600 node-owned file the runner loads into the
 *    CLI's env and deletes, then run: claude --bare -p - --dangerously-skip-permissions --output-format json
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
  const taskPrompt = buildSpecialistTaskPrompt({ task, instructions, workdir });

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

    // Both auth modes go through one credential file: written 600 under umask
    // 077, owned by node (the CLI's user), loaded into the CLI's env by the
    // runner and deleted before the CLI starts. The value is never inlined in
    // the runner script, which is world-readable, and never left in the shared
    // /tmp where a later build's agent could read it.
    const credential = claudeCredential(auth);
    await writeSandboxFile({ containerId: SANDBOX_CONTAINER, path: tokenFile, content: credential.value, ownerOnly: true, chownNodeUser: true });
    const modeLabel = auth.mode === "oauth" ? "Max Plan (OAuth)" : "API key (per-token)";
    const timeoutMs = role === "data-architect" ? CLAUDE_SCHEMA_TASK_TIMEOUT_MS : CLAUDE_TASK_TIMEOUT_MS;

    const runnerScript = `/tmp/claude-run-${taskSlug}.sh`;
    const script = [
      "#!/bin/sh",
      `cd ${workdir}`,
      // The repo SessionStart hook would call the build clone a shared root clone.
      "export DPF_SKIP_CLONE_OCCUPANCY=1",
      ...credentialFileExports(credential.envVar, tokenFile),
      `exec claude ${claudeOneShotArgs({ authMode: auth.mode, sessionId, model }).join(" ")} < ${promptFile}`,
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

    // The driver reads the json result: answer, session, cost and usage (BI-89030C9B Phase 1 $/build).
    const result = parseClaudeResult(stdout);
    // A JSON result with no answer reports "no output" below, as before.
    const content = result.json && !result.hasResult ? "" : result.text;
    const returnedSessionId = result.sessionId;
    const costUsd = result.costUsd;
    const inputTokens = result.usageReported ? result.usage.inputTokens : undefined;
    const outputTokens = result.usageReported ? result.usage.outputTokens : undefined;

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
  } finally {
    // The runner deletes the credential once read; this covers a run that
    // failed before the runner reached that line.
    await removeSandboxFiles(SANDBOX_CONTAINER, [tokenFile]);
  }
}
