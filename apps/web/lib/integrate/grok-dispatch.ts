// apps/web/lib/integrate/grok-dispatch.ts
// Dispatch build tasks to Grok (xAI) CLI running inside the sandbox container.
//
// This is the dedicated Grok equivalent of claude-dispatch.ts and codex-dispatch.ts.
// Designed to provide comparable robustness for Build Studio specialist tasks.
//
// Host OS note (Windows vs macOS/Linux):
//   - All Grok CLI execution for Build Studio / AI Coworker (specialist tasks, Ideate dispatch)
//     happens via `docker exec` *inside the Linux-based sandbox container*.
//   - The host OS of the machine running the DPF portal has no material effect on dispatch
//     behavior, auth injection (XAI_API_KEY), progress parsing, timeouts, or result handling.
//   - Host differences only affect: (a) bootstrap detection of the local `grok` binary on the
//     operator's machine, and (b) where the operator places their local ~/.grok/config.toml
//     for direct CLI usage (see mcp-setup-snippets.ts and packages/dpf-skill-pack/README.md).
//   - This matches the architecture for Claude Code and Codex dispatch.

import type { AssignedTask } from "./task-dependency-graph";
import type { SpecialistRole } from "./task-dependency-graph";
import { getDecryptedCredential } from "@/lib/inference/ai-provider-internals";
import { lazyChildProcess, lazyUtil } from "@/lib/shared/lazy-node";
import { recordBuildDispatchAttempt } from "@/lib/build/dispatch-attempts";

const DEFAULT_SANDBOX_CONTAINER = process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1";

const GROK_TASK_TIMEOUT_MS = 900_000;       // 15 minutes default
const GROK_SCHEMA_TASK_TIMEOUT_MS = 1_200_000; // 20 minutes for schema tasks

export type GrokResult = {
  content: string;
  success: boolean;
  executedTools: Array<{ name: string; args: unknown; result: { success: boolean } }>;
  durationMs: number;
};

/**
 * Inject Grok API key into the sandbox as XAI_API_KEY (per-task file for safety).
 * Simpler than Codex auth.json or Claude's dual OAuth/apikey modes.
 */
async function ensureGrokAuth(providerId: string, taskSlug: string): Promise<string> {
  const credential = await getDecryptedCredential(providerId);
  const apiKey = credential?.secretRef ?? credential?.cachedToken;

  if (!apiKey) {
    throw new Error(`No xAI API key for provider "${providerId}". Configure via Admin > AI Workforce > External Services.`);
  }

  const { exec: execCb } = lazyChildProcess();
  const { promisify } = lazyUtil();
  const execAsync = promisify(execCb);

  const keyFile = `/tmp/grok-key-${taskSlug}.txt`;
  const keyB64 = Buffer.from(apiKey).toString("base64");
  await execAsync(
    `docker exec ${containerId} sh -c "echo '${keyB64}' | base64 -d > ${keyFile} && chmod 600 ${keyFile}"`,
    { timeout: 5_000 },
  );
  return keyFile;
}

/**
 * Ensure the sandbox /workspace is writable by the node user (uid 1000) and
 * that git is configured for it. Matches the prep done for Claude Code runs
 * (prevents root-owned file issues when the CLI or subsequent steps write).
 */
async function ensureSandboxNodeUser(): Promise<void> {
  const { exec: execCb } = lazyChildProcess();
  const { promisify } = lazyUtil();
  const execAsync = promisify(execCb);

  await execAsync(
    `docker exec ${containerId} sh -c "chown -R node:node /workspace && su -s /bin/sh node -c 'git config --global user.email sandbox@dpf.local && git config --global user.name DPF-Sandbox' 2>/dev/null || true"`,
    { timeout: 15_000 },
  );
}

/**
 * Build context instructions for Grok based on the specialist role.
 * Adapted from the excellent instructions used by Claude and Codex dispatchers,
 * with Grok-specific emphasis on real-time knowledge and current best practices.
 */
function buildGrokInstructions(
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
    roleInstructions[role] || "You are a helpful AI coding agent working inside a DPF monorepo.",
    "",
    "PROJECT CONTEXT:",
    buildContext.slice(0, 3000),
  ];

  if (priorResults) {
    parts.push("", "RESULTS FROM PRIOR TASKS:", priorResults.slice(0, 2000));
  }

  // Grok-specific strengths (real-time knowledge is a core differentiator)
  parts.push(
    "",
    "GROK STRENGTHS: You have strong real-time knowledge and are excellent at reasoning about current events, recent ecosystem changes, and up-to-date best practices. Prefer modern patterns when they are clearly superior."
  );

  // DPF BUILD DISCIPLINE — per AGENTS.md §7 Subagent Dispatch (parity with other CLIs)
  parts.push(
    "",
    "DPF BUILD DISCIPLINE (MANDATORY):",
    "- For ANY TypeScript work: run `pnpm --filter web typecheck` (or `pnpm exec tsc --noEmit`) and fix errors before finishing.",
    "- For final-task-in-epic or any UI change: ALSO run `cd apps/web && npx next build` and fix errors.",
    "- UI work MUST follow Theme-Aware Styling: ONLY use CSS custom properties (`text-[var(--dpf-text)]`, `bg-[var(--dpf-surface-1)]`, etc.). NEVER hardcode colors, tailwind gray-*, or raw hex.",
    "- Always operate from monorepo root /workspace. Use exact paths from the FILES section."
  );

  return parts.join("\n");
}

/**
 * Dispatch a single build task to Grok CLI inside the sandbox container.
 *
 * Robust implementation on par with claude-dispatch.ts and codex-dispatch.ts:
 * - Per-task temp files + runner script (quoting safety, parallel safety)
 * - Runs as non-root `node` user after chown/gitconfig prep
 * - Real-time stderr progress streaming with patterns from observed CLI output
 * - Role-based timeouts (longer for schema)
 * - Audit via recordBuildDispatchAttempt
 * - Graceful fallback for Grok CLI output format (text today; --json when supported)
 *
 * Grok uniques vs peers:
 * - Auth: single XAI_API_KEY env (no auth.json dance, no OAuth refresh)
 * - Binary: `grok` (with -p for prompt, --dangerously-skip-permissions supported)
 * - Session: lighter (no persistent sessionId yet)
 */
export async function dispatchGrokTask(params: {
  task: AssignedTask;
  buildId: string;
  buildContext: string;
  priorResults?: string;
  providerId?: string;
  model?: string;
  containerId?: string;   // Preferred: pass from SandboxHandle so we honor the BuildExecutionProvider abstraction
  onProgress?: (message: string) => void;
}): Promise<GrokResult> {
  const { task, buildContext, priorResults } = params;
  const providerId = params.providerId ?? "xai";
  const model = params.model ?? "";
  const role = task.specialist;
  const containerId = params.containerId ?? DEFAULT_SANDBOX_CONTAINER;
  const startedAt = new Date();

  // Use a strong unique ID per dispatch invocation (not just task title) to prevent
  // collisions in concurrent Build Studio builds or parallel specialist tasks.
  const runId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const safeRunId = runId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 48);
  const promptFile = `/tmp/grok-prompt-${safeRunId}.txt`;
  const keyFile = `/tmp/grok-key-${safeRunId}.txt`;
  const runnerScript = `/tmp/grok-run-${safeRunId}.sh`;

  const timeoutMs = role === "data-architect" ? GROK_SCHEMA_TASK_TIMEOUT_MS : GROK_TASK_TIMEOUT_MS;

  try {
    await ensureSandboxNodeUser();
  } catch {
    // Non-fatal; proceed (some sandboxes may already be correct)
  }

  let authKeyFile: string;
  try {
    authKeyFile = await ensureGrokAuth(providerId, taskSlug);
  } catch (err) {
    return {
      content: `Auth error: ${(err as Error).message}`,
      success: false,
      executedTools: [],
      durationMs: 0,
    };
  }

  const instructions = buildGrokInstructions(role, buildContext, priorResults);

  const taskFiles = task.files
    .map(f => `- ${f.path} (${f.action}): ${f.purpose}`)
    .join("\n");

  const taskPrompt = [
    instructions,
    "",
    "CRITICAL: This is a pnpm monorepo. The Next.js app is at apps/web/. All file paths MUST use the full monorepo-relative path (e.g. apps/web/lib/... not lib/..., apps/web/app/... not app/...). The FILES section below has the authoritative paths — use those exactly. Working directory is /workspace (the monorepo root).",
    "",
    `TASK: ${task.title}`,
    "",
    task.task.implement || "",
    "",
    taskFiles ? `FILES (use these exact paths):\n${taskFiles}` : "",
    "",
    task.task.testFirst ? `TEST FIRST: ${task.task.testFirst}` : "",
    task.task.verify ? `VERIFY: ${task.task.verify}` : "",
  ].filter(Boolean).join("\n");

  const startMs = Date.now();

  try {
    const execAsync = lazyUtil().promisify(lazyChildProcess().exec);
    const spawnCb = lazyChildProcess().spawn;

    // Write prompt with restrictive perms (0600). Key file was already written 0600 by ensureGrokAuth.
    const promptB64 = Buffer.from(taskPrompt).toString("base64");
    await execAsync(
      `docker exec ${containerId} sh -c "echo '${promptB64}' | base64 -d > ${promptFile} && chmod 600 ${promptFile}"`,
      { timeout: 5_000 },
    );

    const modelFlag = model ? `--model ${model}` : "";

    // Write runner script with trap-based cleanup (critical for concurrent builds + secret hygiene).
    const script = [
      "#!/bin/sh",
      "set -e",
      `cleanup() { rm -f ${promptFile} ${keyFile} ${runnerScript} 2>/dev/null || true; }`,
      "trap cleanup EXIT INT TERM",
      "cd /workspace",
      `export XAI_API_KEY=$(cat ${authKeyFile} 2>/dev/null || echo '')`,
      `grok ${modelFlag} -p - --always-approve --no-auto-update < ${promptFile}`,
      "cleanup",
    ].join("\n");
    const scriptB64 = Buffer.from(script).toString("base64");
    await execAsync(
      `docker exec ${containerId} sh -c "echo '${scriptB64}' | base64 -d > ${runnerScript} && chmod 700 ${runnerScript}"`,
      { timeout: 5_000 },
    );

    console.log(`[grok-dispatch] Starting task "${task.title}" with Grok ${model || "default"} in ${containerId} (timeout: ${timeoutMs / 1000}s)`);

    // Spawn as node user (parity with Claude) + stream progress from stderr
    const { stdout, durationMs: elapsed } = await new Promise<{ stdout: string; durationMs: number }>((resolve, reject) => {
      const proc = spawnCb("docker", [
        "exec", "--user", "node", SANDBOX_CONTAINER, runnerScript,
      ]);

      let stdout = "";
      let stderrBuf = "";
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGTERM");
      }, timeoutMs);

      proc.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data: Buffer) => {
        const chunk = data.toString();
        stderrBuf += chunk;
        const lines = chunk.split("\n").filter(Boolean);
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          // Claude-style exact prefixes (when Grok CLI emits similar) + flexible fallbacks
          if (trimmed.startsWith("Reading file:")) {
            params.onProgress?.(`Reading ${trimmed.replace("Reading file: ", "")}`);
          } else if (trimmed.startsWith("Writing file:") || trimmed.startsWith("Creating file:")) {
            params.onProgress?.(`Writing ${trimmed.replace(/^(Writing|Creating) file: /, "")}`);
          } else if (trimmed.startsWith("Editing file:")) {
            params.onProgress?.(`Editing ${trimmed.replace("Editing file: ", "")}`);
          } else if (trimmed.startsWith("Running bash command:") || trimmed.startsWith("Running command:")) {
            params.onProgress?.(`Running: ${trimmed.replace(/^Running( bash)? command: /, "").slice(0, 80)}`);
          } else if (trimmed === "Thinking..." || trimmed.toLowerCase().includes("thinking")) {
            params.onProgress?.("Thinking...");
          } else if (trimmed.toLowerCase().includes("reading") || trimmed.toLowerCase().includes("editing") || trimmed.toLowerCase().includes("writing") || trimmed.toLowerCase().includes("applying")) {
            // Generic fallback for Grok CLI's natural language output
            params.onProgress?.(trimmed.slice(0, 120));
          }
        }
      });

      proc.on("close", (code: number | null) => {
        clearTimeout(timer);
        const d = Date.now() - startMs;
        if (timedOut) {
          reject(Object.assign(new Error(`Timed out after ${timeoutMs / 1000}s`), { stdout, killed: true }));
        } else if (code === 0 || stdout.trim()) {
          resolve({ stdout, durationMs: d });
        } else {
          console.error(`[grok-dispatch] Task "${task.title}" stderr: ${stderrBuf.slice(0, 500)}`);
          reject(Object.assign(new Error(`Exit code ${code}`), { stdout, code, stderr: stderrBuf }));
        }
      });

      proc.on("error", (err: Error) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    // Best-effort JSON extraction (Grok CLI may add --json later; today mostly text)
    let content: string;
    try {
      const parsed = JSON.parse(stdout.trim());
      content = typeof parsed.result === "string" ? parsed.result : JSON.stringify(parsed.result);
    } catch {
      content = stdout.trim();
    }

    console.log(`[grok-dispatch] Task "${task.title}" completed in ${(elapsed / 1000).toFixed(1)}s (${content.length} chars)`);

    await recordBuildDispatchAttempt({
      buildId: params.buildId,
      taskTitle: task.title,
      specialist: role,
      providerId,
      model: model || null,
      startedAt,
      completedAt: new Date(),
      durationMs: elapsed,
      exitCode: 0,
      success: true,
      stdout: content,
      stderr: "",
    });

    return {
      content: content || "Grok task completed with no output.",
      success: true,
      executedTools: [],
      durationMs: elapsed,
    };
  } catch (err) {
    const durationMs = Date.now() - startMs;
    const execErr = err as { stdout?: string; stderr?: string; message?: string; killed?: boolean; code?: number | null };
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
      stderr: output || execErr.message || "",
    });

    return {
      content: `Grok dispatch failed: ${execErr.message || "Unknown error"}${execErr.killed ? " (timed out)" : ""}`,
      success: false,
      executedTools: [],
      durationMs,
    };
  }
}
