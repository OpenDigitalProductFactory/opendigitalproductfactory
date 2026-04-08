// apps/web/lib/integrate/codex-dispatch.ts
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
import type { SpecialistRole } from "./task-dependency-graph";
import { getDecryptedCredential } from "@/lib/inference/ai-provider-internals";

const SANDBOX_CONTAINER = process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1";

// Codex model — configurable, defaults to o4-mini (fast, tool-capable)
const CODEX_MODEL = process.env.CODEX_MODEL ?? "o4-mini";

// Timeout for a single Codex task (10 minutes — generous for complex tasks)
const CODEX_TASK_TIMEOUT_MS = 600_000;

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
async function injectCodexAuth(): Promise<void> {
  const credential = await getDecryptedCredential("codex");
  if (!credential?.cachedToken) {
    throw new Error("No Codex OAuth token available. Log in via Admin > AI Workforce > OpenAI/Codex.");
  }

  const authJson = JSON.stringify({
    auth_mode: "chatgptAuthTokens",
    tokens: {
      access_token: credential.cachedToken,
      refresh_token: credential.refreshToken ?? "",
      account_id: null,
    },
    last_refresh: new Date().toISOString(),
  });

  const { exec: execCb } = await import(/* turbopackIgnore: true */ "child_process");
  const { promisify } = await import(/* turbopackIgnore: true */ "util");
  const execAsync = promisify(execCb);

  // Write auth.json to ~/.codex/ in the sandbox container
  const authB64 = Buffer.from(authJson).toString("base64");
  await execAsync(
    `docker exec ${SANDBOX_CONTAINER} sh -c "mkdir -p /root/.codex && echo '${authB64}' | base64 -d > /root/.codex/auth.json"`,
    { timeout: 5_000 },
  );
}

/**
 * Build context instructions for Codex based on the specialist role.
 */
function buildCodexInstructions(
  role: SpecialistRole,
  buildContext: string,
  priorResults?: string,
): string {
  const roleInstructions: Record<SpecialistRole, string> = {
    "data-architect": `You are a data architect working on a Prisma schema.
Key files:
- Schema: packages/db/prisma/schema.prisma
- Validate with: pnpm --filter @dpf/db exec prisma validate
- After changes: pnpm --filter @dpf/db exec prisma migrate dev --name <descriptive_name>
- Then: pnpm --filter @dpf/db exec prisma generate
- Enums use LOWERCASE values. Multi-word statuses use hyphens: "in-progress" not "in_progress".
- Every foreign key field (xxxId) needs @@index.
- Relations need inverse on BOTH sides.`,

    "software-engineer": `You are a software engineer building Next.js server actions and API routes.
Key patterns:
- Server actions: apps/web/lib/actions/<feature>.ts — "use server" directive, prisma queries
- API routes: apps/web/app/api/<feature>/route.ts — GET/POST/PATCH/DELETE handlers
- Always read an existing similar file first to match patterns.
- Typecheck with: pnpm exec tsc --noEmit`,

    "frontend-engineer": `You are a frontend engineer building Next.js pages and React components.
Key patterns:
- Pages: apps/web/app/(shell)/<feature>/page.tsx — server components with prisma queries
- Components: apps/web/components/<feature>/ — client components with "use client"
- Use Tailwind CSS. Match existing design patterns.
- Read an existing page first to understand the layout structure.
- Typecheck with: pnpm exec tsc --noEmit`,

    "qa-engineer": `You are a QA engineer verifying the build.
- Run tests: pnpm exec vitest run --reporter=verbose
- Run typecheck: pnpm exec tsc --noEmit
- Check for runtime errors in the build output
- Report specific failures with file paths and line numbers`,
  };

  const parts = [
    roleInstructions[role],
    "",
    "PROJECT CONTEXT:",
    buildContext.slice(0, 3000),
  ];

  if (priorResults) {
    parts.push("", "RESULTS FROM PRIOR TASKS:", priorResults.slice(0, 2000));
  }

  return parts.join("\n");
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
}): Promise<CodexResult> {
  const { task, buildContext, priorResults } = params;
  const role = task.specialist;

  // Write OAuth tokens to ~/.codex/auth.json in the sandbox container
  try {
    await injectCodexAuth();
  } catch (err) {
    return {
      content: `Auth error: ${(err as Error).message}`,
      success: false,
      executedTools: [],
      durationMs: 0,
    };
  }

  const instructions = buildCodexInstructions(role, buildContext, priorResults);

  const taskFiles = task.files
    .map(f => `- ${f.path} (${f.action}): ${f.purpose}`)
    .join("\n");

  const taskPrompt = [
    instructions,
    "",
    `TASK: ${task.title}`,
    "",
    task.task.implement || "",
    "",
    taskFiles ? `FILES:\n${taskFiles}` : "",
    "",
    task.task.testFirst ? `TEST FIRST: ${task.task.testFirst}` : "",
    task.task.verify ? `VERIFY: ${task.task.verify}` : "",
  ].filter(Boolean).join("\n");

  const startMs = Date.now();

  try {
    const { exec: execCb } = await import(/* turbopackIgnore: true */ "child_process");
    const { promisify } = await import(/* turbopackIgnore: true */ "util");
    const execAsync = promisify(execCb);

    // Write prompt to temp file in sandbox (avoids all shell escaping issues)
    const promptB64 = Buffer.from(taskPrompt).toString("base64");
    await execAsync(
      `docker exec ${SANDBOX_CONTAINER} sh -c "echo '${promptB64}' | base64 -d > /tmp/codex-prompt.txt"`,
      { timeout: 5_000 },
    );

    console.log(`[codex-dispatch] Starting task "${task.title}" with ${CODEX_MODEL} in ${SANDBOX_CONTAINER}`);

    // Run Codex CLI with auth from ~/.codex/auth.json (written by injectCodexAuth)
    // --full-auto: workspace-write sandbox, no approval prompts
    // --skip-git-repo-check: sandbox workspace may not have git init yet
    // Prompt read from temp file via stdin to avoid shell escaping
    const { stdout } = await execAsync(
      `docker exec ${SANDBOX_CONTAINER} sh -c "cd /workspace && codex exec --full-auto --skip-git-repo-check -m ${CODEX_MODEL} < /tmp/codex-prompt.txt 2>&1"`,
      {
        maxBuffer: 10 * 1024 * 1024,
        timeout: CODEX_TASK_TIMEOUT_MS,
      },
    );

    const durationMs = Date.now() - startMs;
    const content = stdout.trim();

    console.log(`[codex-dispatch] Task "${task.title}" completed in ${(durationMs / 1000).toFixed(1)}s (${content.length} chars)`);

    return {
      content: content || "Task completed with no output.",
      success: true,
      executedTools: [],
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - startMs;
    const execErr = err as { stdout?: string; stderr?: string; message?: string; code?: number; killed?: boolean };
    const output = (execErr.stdout ?? "") + "\n" + (execErr.stderr ?? "");

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
