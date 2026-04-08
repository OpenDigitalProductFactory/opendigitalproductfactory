// apps/web/lib/integrate/claude-dispatch.ts
// Dispatch build tasks to Claude Code CLI running inside the sandbox container.
//
// Mirrors codex-dispatch.ts exactly but for Anthropic's Claude Code CLI.
// Auth: uses OAuth token from Claude Max subscription (flat-rate, no per-token cost).
// The token is fetched from the portal's credential store and injected as
// CLAUDE_CODE_OAUTH_TOKEN env var on the docker exec command.

import type { AssignedTask } from "./task-dependency-graph";
import type { SpecialistRole } from "./task-dependency-graph";
import { getDecryptedCredential } from "@/lib/inference/ai-provider-internals";

const SANDBOX_CONTAINER = process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1";

// Claude Code model — configurable via env var. Default: sonnet (best cost/quality for builds).
const CLAUDE_CODE_MODEL = process.env.CLAUDE_CODE_MODEL ?? "sonnet";

// Timeout for a single Claude Code task (10 minutes — generous for complex tasks)
const CLAUDE_TASK_TIMEOUT_MS = 600_000;

export type ClaudeResult = {
  content: string;       // Claude's response text
  success: boolean;
  executedTools: Array<{ name: string; args: unknown; result: { success: boolean } }>;
  durationMs: number;
};

/**
 * Build the CLAUDE_CODE_OAUTH_TOKEN JSON string from the credential store.
 *
 * Claude Code CLI reads auth from the CLAUDE_CODE_OAUTH_TOKEN env var.
 * Format: { accessToken, refreshToken, expiresAt }
 */
async function buildClaudeAuthToken(): Promise<string> {
  const credential = await getDecryptedCredential("claude-code");
  if (!credential?.cachedToken) {
    throw new Error("No Claude Code OAuth token available. Log in via Admin > AI Workforce > Claude Code.");
  }

  const oauthToken = JSON.stringify({
    accessToken: credential.cachedToken,
    refreshToken: credential.refreshToken ?? "",
    expiresAt: credential.tokenExpiresAt?.toISOString() ?? "",
  });

  return oauthToken;
}

/**
 * Build context instructions for Claude Code based on the specialist role.
 * Same role instructions as codex-dispatch.ts.
 */
function buildClaudeInstructions(
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
 * Dispatch a single build task to Claude Code CLI inside the sandbox container.
 *
 * Flow:
 * 1. Get OAuth token from portal credential store
 * 2. Write prompt to a temp file in the sandbox (avoids shell escaping issues)
 * 3. Run: CLAUDE_CODE_OAUTH_TOKEN=<json> claude --bare -p - --dangerously-skip-permissions --output-format json --model <model>
 * 4. Parse JSON output, extract .result field for content
 */
export async function dispatchClaudeTask(params: {
  task: AssignedTask;
  buildId: string;
  buildContext: string;
  priorResults?: string;
}): Promise<ClaudeResult> {
  const { task, buildContext, priorResults } = params;
  const role = task.specialist;

  // Build OAuth token JSON for CLAUDE_CODE_OAUTH_TOKEN env var
  let oauthTokenJson: string;
  try {
    oauthTokenJson = await buildClaudeAuthToken();
  } catch (err) {
    return {
      content: `Auth error: ${(err as Error).message}`,
      success: false,
      executedTools: [],
      durationMs: 0,
    };
  }

  const instructions = buildClaudeInstructions(role, buildContext, priorResults);

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
      `docker exec ${SANDBOX_CONTAINER} sh -c "echo '${promptB64}' | base64 -d > /tmp/claude-prompt.txt"`,
      { timeout: 5_000 },
    );

    // Write OAuth token to temp file (avoids shell escaping of JSON in -e flag)
    const tokenB64 = Buffer.from(oauthTokenJson).toString("base64");
    await execAsync(
      `docker exec ${SANDBOX_CONTAINER} sh -c "echo '${tokenB64}' | base64 -d > /tmp/claude-oauth-token.json"`,
      { timeout: 5_000 },
    );

    console.log(`[claude-dispatch] Starting task "${task.title}" with ${CLAUDE_CODE_MODEL} in ${SANDBOX_CONTAINER}`);

    // Run Claude Code CLI with OAuth token from temp file.
    // --bare: skips local hooks, MCP configs, CLAUDE.md (clean for containers)
    // -p -: read prompt from stdin (piped from temp file)
    // --dangerously-skip-permissions: Docker IS the sandbox
    // --output-format json: structured JSON output with { result, session_id, usage }
    // --model: explicit model selection (sonnet/opus/haiku)
    // Stderr redirected to /dev/null to avoid progress noise in output.
    const { stdout } = await execAsync(
      `docker exec ${SANDBOX_CONTAINER} sh -c "cd /workspace && CLAUDE_CODE_OAUTH_TOKEN=\\$(cat /tmp/claude-oauth-token.json) claude --bare -p - --dangerously-skip-permissions --output-format json --model ${CLAUDE_CODE_MODEL} < /tmp/claude-prompt.txt 2>/dev/null"`,
      {
        maxBuffer: 10 * 1024 * 1024,
        timeout: CLAUDE_TASK_TIMEOUT_MS,
      },
    );

    const durationMs = Date.now() - startMs;

    // Parse JSON output — Claude Code --output-format json returns { result, session_id, ... }
    let content: string;
    try {
      const parsed = JSON.parse(stdout.trim());
      content = typeof parsed.result === "string" ? parsed.result : JSON.stringify(parsed.result);
    } catch {
      // If JSON parsing fails, use raw stdout (might be plain text on older versions)
      content = stdout.trim();
    }

    console.log(`[claude-dispatch] Task "${task.title}" completed in ${(durationMs / 1000).toFixed(1)}s (${content.length} chars)`);

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
