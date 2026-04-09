// apps/web/lib/integrate/claude-dispatch.ts
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
import type { SpecialistRole } from "./task-dependency-graph";
import { getDecryptedCredential } from "@/lib/inference/ai-provider-internals";

const SANDBOX_CONTAINER = process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1";

// Timeout for a single Claude Code task (10 minutes — generous for complex tasks)
const CLAUDE_TASK_TIMEOUT_MS = 600_000;

export type ClaudeResult = {
  content: string;       // Claude's response text
  success: boolean;
  executedTools: Array<{ name: string; args: unknown; result: { success: boolean } }>;
  durationMs: number;
  sessionId?: string;    // Claude Code session ID (for session continuity across tasks)
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
  const credential = await getDecryptedCredential(providerId);

  // Auth mode is implicit in the provider ID:
  //   "anthropic-sub" → OAuth (Max Plan subscription, flat-rate)
  //   "anthropic"     → API key (per-token billing)
  const isOAuth = providerId === "anthropic-sub";

  if (!isOAuth) {
    const apiKey = credential?.secretRef ?? credential?.cachedToken;
    if (!apiKey) {
      throw new Error(`No Anthropic API key for provider "${providerId}". Configure via Admin > AI Workforce > External Services.`);
    }
    return { mode: "apikey", apiKey };
  }

  if (!credential?.cachedToken) {
    throw new Error(`No OAuth token for provider "${providerId}". Configure via Admin > AI Workforce > External Services.`);
  }

  // CLAUDE_CODE_OAUTH_TOKEN takes the raw access token string (sk-ant-oat01-...),
  // NOT a JSON object. The JSON format is for ~/.claude/.credentials.json only.
  return { mode: "oauth", tokenJson: credential.cachedToken };
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
}): Promise<ClaudeResult> {
  const { task, buildContext, priorResults } = params;
  const providerId = params.providerId ?? "anthropic-sub";
  const model = params.model ?? "sonnet";
  const sessionId = params.sessionId;
  const role = task.specialist;

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

    // Ensure /workspace is writable by the node user (uid 1000).
    // Files may be root-owned from bootstrap or prior Codex runs.
    // Also set git config for node user (Claude Code may run git commands).
    await execAsync(
      `docker exec ${SANDBOX_CONTAINER} sh -c "chown -R node:node /workspace && su -s /bin/sh node -c 'git config --global user.email sandbox@dpf.local && git config --global user.name DPF-Sandbox' 2>/dev/null"`,
      { timeout: 15_000 },
    );

    // Write prompt to temp file in sandbox (avoids all shell escaping issues).
    // chmod 644 so the non-root node user can read it.
    const promptB64 = Buffer.from(taskPrompt).toString("base64");
    await execAsync(
      `docker exec ${SANDBOX_CONTAINER} sh -c "echo '${promptB64}' | base64 -d > /tmp/claude-prompt.txt && chmod 644 /tmp/claude-prompt.txt"`,
      { timeout: 5_000 },
    );

    // Inject auth credentials into the sandbox container.
    // Claude Code CLI must run as non-root (--dangerously-skip-permissions refuses root).
    // OAuth mode: CLAUDE_CODE_OAUTH_TOKEN takes the raw access token string, NOT JSON.
    //   --bare is NOT used — it disables OAuth (only allows ANTHROPIC_API_KEY).
    // API key mode: ANTHROPIC_API_KEY with --bare for clean isolation.
    let authEnvFragment: string;
    let useBareflag: boolean;
    if (auth.mode === "oauth") {
      // OAuth (Max Plan): write raw token to temp file, read at exec time
      const tokenB64 = Buffer.from(auth.tokenJson).toString("base64");
      await execAsync(
        `docker exec ${SANDBOX_CONTAINER} sh -c "echo '${tokenB64}' | base64 -d > /tmp/claude-oauth-token.txt && chmod 644 /tmp/claude-oauth-token.txt"`,
        { timeout: 5_000 },
      );
      authEnvFragment = "CLAUDE_CODE_OAUTH_TOKEN=\\$(cat /tmp/claude-oauth-token.txt)";
      useBareflag = false;  // --bare disables OAuth
    } else {
      // API key: inject directly as env var (simple string, no escaping issues)
      authEnvFragment = `ANTHROPIC_API_KEY=${auth.apiKey}`;
      useBareflag = true;   // --bare is safe with API key
    }

    const modeLabel = auth.mode === "oauth" ? "Max Plan (OAuth)" : "API key (per-token)";
    const bareFlag = useBareflag ? "--bare " : "";
    const sessionFlag = sessionId ? `--session-id ${sessionId} ` : "";
    console.log(`[claude-dispatch] Starting task "${task.title}" with ${model} [${modeLabel}]${sessionId ? ` [session: ${sessionId}]` : ""} in ${SANDBOX_CONTAINER}`);

    // Run Claude Code CLI as non-root user (node, uid 1000).
    // -p -: read prompt from stdin (piped from temp file)
    // --dangerously-skip-permissions: Docker IS the sandbox (refuses root)
    // --output-format json: structured JSON output with { result, session_id, usage }
    // --model: explicit model selection (sonnet/opus/haiku)
    // Stderr redirected to /dev/null to avoid progress noise in output.
    const { stdout } = await execAsync(
      `docker exec --user node ${SANDBOX_CONTAINER} sh -c "cd /workspace && ${authEnvFragment} claude ${bareFlag}${sessionFlag}-p - --dangerously-skip-permissions --output-format json --model ${model} < /tmp/claude-prompt.txt 2>/dev/null"`,
      {
        maxBuffer: 10 * 1024 * 1024,
        timeout: CLAUDE_TASK_TIMEOUT_MS,
      },
    );

    const durationMs = Date.now() - startMs;

    // Parse JSON output — Claude Code --output-format json returns { result, session_id, ... }
    let content: string;
    let returnedSessionId: string | undefined;
    try {
      const parsed = JSON.parse(stdout.trim());
      content = typeof parsed.result === "string" ? parsed.result : JSON.stringify(parsed.result);
      returnedSessionId = parsed.session_id ?? undefined;
    } catch {
      // If JSON parsing fails, use raw stdout (might be plain text on older versions)
      content = stdout.trim();
    }

    console.log(`[claude-dispatch] Task "${task.title}" completed in ${(durationMs / 1000).toFixed(1)}s (${content.length} chars)${returnedSessionId ? ` [session: ${returnedSessionId}]` : ""}`);

    return {
      content: content || "Task completed with no output.",
      success: true,
      executedTools: [],
      durationMs,
      sessionId: returnedSessionId,
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
