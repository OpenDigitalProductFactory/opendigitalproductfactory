// apps/web/lib/build/codex-dispatch.ts
// Dispatch build tasks to OpenAI Codex CLI running inside the sandbox container.
//
// Instead of our custom agentic loop (routeAndCall → adapter → SSE parser → tool extraction),
// Codex CLI handles everything internally: file reads, writes, edits, command execution.
// We just pass it the task description and capture the result.
//
// Auth: uses the existing OAuth token from the ChatGPT provider (flat-rate subscription).
// The token is fetched from the portal's credential store and injected into the docker exec
// environment. No manual API key configuration needed.

import type { AssignedTask } from "./task-dependency-graph";
import {
  SANDBOX_CONTAINER,
  buildSpecialistInstructions,
  buildSpecialistTaskPrompt,
  runSandboxAgentCli,
  writeSandboxFile,
} from "./sandbox/agent-cli-runtime";
import { getDecryptedCredential } from "@/lib/inference/ai-provider-internals";
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
 * Write Codex CLI auth.json into the sandbox container.
 *
 * Codex CLI reads auth from ~/.codex/auth.json (source: codex-rs/login/src/auth/manager.rs).
 * The JSON structure (from AuthDotJson struct):
 *   { auth_mode, openai_api_key?, tokens?: { access_token, refresh_token, account_id? }, last_refresh? }
 *
 * We populate it with the OAuth tokens from the portal's credential store — the same tokens
 * used for ChatGPT Responses API calls (flat-rate subscription billing).
 */
async function injectCodexAuth(providerId: string): Promise<void> {
  const credential = await getDecryptedCredential(providerId);
  if (!credential?.cachedToken) {
    throw new Error(`No OAuth token for provider "${providerId}". Configure via Admin > AI Workforce > External Services.`);
  }

  // Auth.json format from openai/codex source (codex-rs/login/src/token_data.rs):
  //   TokenData { id_token: IdTokenInfo, access_token, refresh_token, account_id? }
  //   id_token serializes as a raw JWT string (custom serde: serialize_id_token)
  //   On deserialization, id_token JWT is parsed for claims: email, chatgpt_plan_type, etc.
  //
  // AuthDotJson { auth_mode, tokens: TokenData, last_refresh? }
  //
  // auth_mode values (from binary): "chatgpt" | "chatgptAuthTokens" | "chatgptDeviceCode" | "apiKey"
  //   - "chatgpt": browser-based login, expects refresh_token for token renewal
  //   - "chatgptAuthTokens": externally-provided tokens, used as-is (what we need)
  //   - "apiKey": OPENAI_API_KEY env var or auth.json OPENAI_API_KEY field
  //
  // The access_token from ChatGPT OAuth is a JWT with chatgpt_plan_type claim.
  // Using "chatgptAuthTokens" tells Codex CLI to use the tokens directly without
  // attempting refresh (which fails when refresh_token is empty).
  const accessToken = credential.cachedToken;
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

  // Write auth.json to ~/.codex/ in the sandbox container (root — codex runs as
  // root). No chmod (mode omitted): matches the original default-perms write.
  await writeSandboxFile({
    containerId: SANDBOX_CONTAINER,
    path: "/root/.codex/auth.json",
    content: authJson,
    mkdirParents: "/root/.codex",
  });
}

/**
 * Dispatch a single build task to Codex CLI inside the sandbox container.
 *
 * Flow:
 * 1. Get OAuth token from portal credential store
 * 2. Write prompt to a temp file in the sandbox (avoids shell escaping issues)
 * 3. Run: OPENAI_API_KEY=<token> codex exec --full-auto -m <model> < /tmp/prompt.txt
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

  // Write OAuth tokens to ~/.codex/auth.json in the sandbox container
  try {
    await injectCodexAuth(providerId);
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
  const taskPrompt = buildSpecialistTaskPrompt({ task, instructions });

  const startMs = Date.now();

  try {
    // Write prompt to temp file in sandbox (avoids all shell escaping issues).
    // No chmod (codex runs as root and reads its own file) — matches the original.
    await writeSandboxFile({ containerId: SANDBOX_CONTAINER, path: "/tmp/codex-prompt.txt", content: taskPrompt });

    const modelFlag = model ? `-m ${model}` : "";
    const timeoutMs = role === "data-architect" ? CODEX_SCHEMA_TASK_TIMEOUT_MS : CODEX_TASK_TIMEOUT_MS;
    console.log(`[codex-dispatch] Starting task "${task.title}" with ${model || "ChatGPT default"} in ${SANDBOX_CONTAINER} (timeout: ${timeoutMs / 1000}s)`);

    // Shared spawn loop. Codex runs as ROOT via an inline `sh -c` (not a runner
    // script) and resolves on close regardless of exit code — the caller branches
    // on exitCode below. stdout = final agent message; stderr = progress.
    const { stdout, stderr, durationMs, exitCode } = await runSandboxAgentCli({
      containerId: SANDBOX_CONTAINER,
      execArgs: [
        "exec", SANDBOX_CONTAINER, "sh", "-c",
        `cd ${workdir} && codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check ${modelFlag} < /tmp/codex-prompt.txt`,
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
