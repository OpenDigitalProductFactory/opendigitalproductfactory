// apps/web/lib/build/codex-dispatch.ts
// Dispatch build tasks to OpenAI Codex CLI running inside the sandbox container.
//
// Instead of our custom agentic loop (routeAndCall → adapter → SSE parser → tool extraction),
// Codex CLI handles everything internally: file reads, writes, edits, command execution.
// We just pass it the task description and capture the result.
//
// Auth and the command line come from the Codex driver (executor-drivers/codex):
// the ChatGPT subscription's refreshed OAuth token, or the account's API key.

import type { AssignedTask } from "./task-dependency-graph";
import {
  SANDBOX_CONTAINER,
  buildSpecialistInstructions,
  buildSpecialistTaskPrompt,
  runSandboxAgentCli,
  writeSandboxFile,
} from "./sandbox/agent-cli-runtime";
import { codexAuthJson, resolveCodexAuth } from "@/lib/executor-drivers/codex/auth";
import { codexExecArgs } from "@/lib/executor-drivers/codex/exec";
import { recordBuildDispatchAttempt } from "@/lib/build/dispatch-attempts";
import { resolveBuildWorkdir } from "./sandbox/build-branch";

// Timeout per task. Data-architect tasks (schema design) need more time because
// Codex reads the full schema, plans multi-model changes, validates, and iterates.
const CODEX_TASK_TIMEOUT_MS = 900_000;       // 15 minutes default
const CODEX_SCHEMA_TASK_TIMEOUT_MS = 1_200_000; // 20 minutes for schema tasks

export type CodexResult = {
  content: string;       // Codex CLI stdout (summary of what it did)
  success: boolean;
  executedTools: Array<{ name: string; args: unknown; result: { success: boolean } }>;
  durationMs: number;
};

/**
 * Write the Codex driver's credentials where the CLI reads them, for Build
 * Studio and Ideate. Codex runs as root, so ~/.codex is /root/.codex; 600 under umask 077 so no other user can
 * read the tokens.
 */
export async function writeCodexAuth(providerId: string): Promise<void> {
  await writeSandboxFile({
    containerId: SANDBOX_CONTAINER,
    path: "/root/.codex/auth.json",
    content: codexAuthJson(await resolveCodexAuth(providerId)),
    ownerOnly: true,
    mkdirParents: "/root/.codex",
  });
}

/**
 * Dispatch a single build task to Codex CLI inside the sandbox container.
 *
 * Flow:
 * 1. Write the Codex driver's credentials to the sandbox
 * 2. Write prompt to a temp file in the sandbox (avoids shell escaping issues)
 * 3. Run the driver's `codex exec` command with the prompt on stdin
 * 4. Capture stdout as the result
 */
export async function dispatchCodexTask(params: {
  task: AssignedTask;
  buildId: string;
  buildContext: string;
  priorResults?: string;
  providerId?: string;
  model?: string;
  onProgress?: (message: string) => void;
}): Promise<CodexResult> {
  const { task, buildContext, priorResults } = params;
  const providerId = params.providerId ?? "chatgpt";
  const model = params.model ?? "";
  // Per-build working dir: worktree when isolation ON, else /workspace (default).
  const workdir = resolveBuildWorkdir(params.buildId);
  const role = task.specialist;
  const startedAt = new Date();

  try {
    await writeCodexAuth(providerId);
  } catch (err) {
    const completedAt = new Date();
    const content = `Auth error: ${(err as Error).message}`;
    await recordBuildDispatchAttempt({
      buildId: params.buildId,
      taskTitle: task.title,
      specialist: role,
      providerId,
      model: model || null,
      startedAt,
      completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      exitCode: null,
      success: false,
      stdout: "",
      stderr: content,
    });
    return {
      content,
      success: false,
      executedTools: [],
      durationMs: 0,
    };
  }

  const instructions = buildSpecialistInstructions({ role, buildContext, priorResults });
  const taskPrompt = buildSpecialistTaskPrompt({ task, instructions, workdir });

  const startMs = Date.now();

  try {
    // Write prompt to temp file in sandbox (avoids all shell escaping issues).
    // No chmod (codex runs as root and reads its own file) — matches the original.
    await writeSandboxFile({ containerId: SANDBOX_CONTAINER, path: "/tmp/codex-prompt.txt", content: taskPrompt });

    const timeoutMs = role === "data-architect" ? CODEX_SCHEMA_TASK_TIMEOUT_MS : CODEX_TASK_TIMEOUT_MS;
    console.log(`[codex-dispatch] Starting task "${task.title}" with ${model || "ChatGPT default"} in ${SANDBOX_CONTAINER} (timeout: ${timeoutMs / 1000}s)`);

    // Shared spawn loop. Codex runs as ROOT via an inline `sh -c` (not a runner
    // script) and resolves on close regardless of exit code — the caller branches
    // on exitCode below. stdout = final agent message; stderr = progress.
    const { stdout, stderr, durationMs, exitCode } = await runSandboxAgentCli({
      containerId: SANDBOX_CONTAINER,
      execArgs: [
        "exec", SANDBOX_CONTAINER, "sh", "-c",
        `cd ${workdir} && codex ${codexExecArgs({ sandbox: "bypass", model }).join(" ")} < /tmp/codex-prompt.txt`,
      ],
      timeoutMs,
      resolveOnlyOnZeroExit: true,
      onStderrLine: (line) => {
        const trimmed = line.trim();
        // Parse Codex CLI progress from stderr
        if (trimmed.startsWith("Reading file:")) {
          params.onProgress?.(`Reading ${trimmed.replace("Reading file: ", "")}`);
        } else if (trimmed.startsWith("Editing file:")) {
          params.onProgress?.(`Editing ${trimmed.replace("Editing file: ", "")}`);
        } else if (trimmed.startsWith("Writing file:") || trimmed.startsWith("Creating file:")) {
          params.onProgress?.(`Creating ${trimmed.replace(/^(Writing|Creating) file: /, "")}`);
        } else if (trimmed.startsWith("Running command:") || trimmed.startsWith("Running:")) {
          params.onProgress?.(`Running: ${trimmed.replace(/^Running( command)?: /, "").slice(0, 80)}`);
        } else if (trimmed.startsWith("Applying patch")) {
          params.onProgress?.("Applying changes...");
        }
      },
    });

    const content = stdout.trim();
    const success = exitCode === 0;
    await recordBuildDispatchAttempt({
      buildId: params.buildId,
      taskTitle: task.title,
      specialist: role,
      providerId,
      model: model || null,
      startedAt,
      completedAt: new Date(),
      durationMs,
      exitCode,
      success,
      stdout,
      stderr,
    });

    if (success) {
      console.log(`[codex-dispatch] Task "${task.title}" completed in ${(durationMs / 1000).toFixed(1)}s (${content.length} chars)`);
    } else {
      console.log(`[codex-dispatch] Task "${task.title}" failed with exit code ${exitCode}. Output: ${(stdout || stderr).slice(0, 200)}`);
    }

    return {
      content: content || "Task completed with no output.",
      success,
      executedTools: [],
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - startMs;
    const execErr = err as { stdout?: string; stderr?: string; message?: string; code?: number; killed?: boolean };
    const output = (execErr.stdout ?? "") + "\n" + (execErr.stderr ?? "");
    await recordBuildDispatchAttempt({
      buildId: params.buildId,
      taskTitle: task.title,
      specialist: role,
      providerId,
      model: model || null,
      startedAt,
      completedAt: new Date(),
      durationMs,
      exitCode: execErr.code ?? null,
      success: false,
      stdout: execErr.stdout ?? "",
      stderr: execErr.stderr ?? execErr.message ?? "",
      timedOut: execErr.killed === true,
    });

    if (execErr.killed) {
      console.warn(`[codex-dispatch] Task "${task.title}" killed after ${CODEX_TASK_TIMEOUT_MS / 1000}s timeout`);
      return {
        content: `Task timed out after ${CODEX_TASK_TIMEOUT_MS / 1000}s. Partial output:\n${output.slice(-2000)}`,
        success: false,
        executedTools: [],
        durationMs,
      };
    }

    if (output.trim()) {
      console.log(`[codex-dispatch] Task "${task.title}" exited with code ${execErr.code}. Output: ${output.slice(0, 200)}`);
      return {
        content: output.trim().slice(-5000),
        success: execErr.code === 0,
        executedTools: [],
        durationMs,
      };
    }

    console.error(`[codex-dispatch] Task "${task.title}" failed: ${execErr.message?.slice(0, 200)}`);
    return {
      content: `Codex CLI error: ${execErr.message?.slice(0, 1000) ?? "Unknown error"}`,
      success: false,
      executedTools: [],
      durationMs,
    };
  }
}
