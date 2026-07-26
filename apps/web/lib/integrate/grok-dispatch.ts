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

import type { AssignedTask, SpecialistRole } from "./task-dependency-graph";
import {
  buildSpecialistInstructions,
  buildSpecialistTaskPrompt,
  ensureSandboxNodeUser,
  runSandboxAgentCli,
  sandboxExec,
  writeSandboxFile,
} from "./sandbox/agent-cli-runtime";
import { ensureSandboxGrokGovernance } from "./sandbox/grok-governance-seed";
import { getDecryptedCredential } from "@/lib/inference/ai-provider-internals";
import { resolveBuildWorkdir } from "./sandbox/build-branch";
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

type GrokAuthInjection =
  | { mode: "oauth" }                    // ~/.grok/auth.json written for the node user; grok reads it
  | { mode: "apikey"; keyFile: string }; // XAI_API_KEY sourced from this file

/**
 * Provision Grok auth into the sandbox. Two modes, OAuth preferred:
 *  - OAuth (subscription "sign in with Google"): the stored credential is the
 *    `~/.grok/auth.json` blob captured by the device-code login flow
 *    (lib/actions/grok-device-login.ts). It is written into the node user's
 *    ~/.grok so the CLI uses it directly and self-refreshes from its embedded
 *    refresh token — mirrors codex-dispatch's injectCodexAuth (~/.codex/auth.json).
 *  - API key: the stored credential is a bare xAI key, exported as XAI_API_KEY.
 */
async function ensureGrokAuth(providerId: string, containerId: string, taskSlug: string): Promise<GrokAuthInjection> {
  const credential = await getDecryptedCredential(providerId);

  // OAuth credential = the whole ~/.grok/auth.json JSON blob, stored in cachedToken.
  const oauthBlob =
    credential?.cachedToken && credential.cachedToken.trimStart().startsWith("{")
      ? credential.cachedToken
      : null;

  if (oauthBlob) {
    // Write as the `node` user (the same user the dispatch runs grok as) so the
    // CLI finds it at ~/.grok/auth.json. 600 — it carries a refresh token.
    await writeSandboxFile({
      containerId,
      path: "~/.grok/auth.json",
      content: oauthBlob,
      mode: "600",
      asNodeUser: true,
      mkdirParents: "~/.grok",
    });
    return { mode: "oauth" };
  }

  // API-key fallback.
  const apiKey = credential?.secretRef ?? credential?.cachedToken;
  if (!apiKey) {
    throw new Error(`No xAI credential for provider "${providerId}". Sign in to Grok (OAuth) or add an API key via Admin > AI Workforce > External Services.`);
  }
  const keyFile = `/tmp/grok-key-${taskSlug}.txt`;
  await writeSandboxFile({ containerId, path: keyFile, content: apiKey, mode: "600" });
  return { mode: "apikey", keyFile };
}

/**
 * Refresh durability. After an OAuth-mode run, the Grok CLI may have refreshed its access
 * token (and, if xAI rotates them, its refresh token) and rewritten ~/.grok/auth.json
 * inside the build sandbox. That sandbox is ephemeral, so read the (possibly-updated)
 * credential back out and persist it to the stored xAI credential — otherwise the next
 * build keeps injecting the original token, which eventually goes stale.
 *
 * Last-write-wins under concurrent builds (acceptable for non-rotating refresh tokens;
 * rotating-token concurrency is a known edge — see the device-code OAuth design doc).
 * Best-effort: never fails the build.
 */
async function persistRefreshedGrokOAuth(providerId: string, containerId: string): Promise<void> {
  const read = await sandboxExec()(
    `docker exec --user node ${containerId} sh -c "cat ~/.grok/auth.json 2>/dev/null || true"`,
    { timeout: 5_000 },
  ).catch(() => ({ stdout: "" }));
  const blob = String((read as { stdout?: string }).stdout ?? "").trim();
  if (!blob.startsWith("{")) return;

  const current = await getDecryptedCredential(providerId);
  if (current?.cachedToken && current.cachedToken.trim() === blob) return; // unchanged — no write

  const [{ prisma }, { encryptSecret }] = await Promise.all([
    import("@dpf/db"),
    import("@/lib/credential-crypto"),
  ]);
  await prisma.credentialEntry.update({
    where: { providerId },
    data: { cachedToken: encryptSecret(blob), status: "ok" },
  });
  console.log(`[grok-dispatch] persisted refreshed Grok OAuth token for "${providerId}".`);
}

/**
 * Build context instructions for Grok based on the specialist role.
 * Reuses the shared specialist instruction builder, then layers Grok-specific
 * emphasis (real-time knowledge) and the DPF build discipline block on top.
 */
function buildGrokInstructions(
  role: SpecialistRole,
  buildContext: string,
  priorResults?: string,
): string {
  return buildSpecialistInstructions({
    role,
    buildContext,
    priorResults,
    fallbackInstruction: "You are a helpful AI coding agent working inside a DPF monorepo.",
    extraDisciplineLines: [
      // Grok-specific strengths (real-time knowledge is a core differentiator)
      "GROK STRENGTHS: You have strong real-time knowledge and are excellent at reasoning about current events, recent ecosystem changes, and up-to-date best practices. Prefer modern patterns when they are clearly superior.",
      "",
      // DPF BUILD DISCIPLINE — per AGENTS.md §7 Subagent Dispatch (parity with other CLIs)
      "DPF BUILD DISCIPLINE (MANDATORY):",
      "- For ANY TypeScript work: run `pnpm --filter web typecheck` (or `pnpm exec tsc --noEmit`) and fix errors before finishing.",
      "- For final-task-in-epic or any UI change: ALSO run `cd apps/web && npx next build` and fix errors.",
      "- UI work MUST follow Theme-Aware Styling: ONLY use CSS custom properties (`text-[var(--dpf-text)]`, `bg-[var(--dpf-surface-1)]`, etc.). NEVER hardcode colors, tailwind gray-*, or raw hex.",
      "- Always operate from monorepo root /workspace. Use exact paths from the FILES section.",
    ],
  });
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
 * Grok uniques vs peers (verified against grok 0.2.32):
 * - Auth: single XAI_API_KEY env (no auth.json dance, no OAuth refresh)
 * - Binary: `grok` (official xAI Build CLI; --prompt-file + --always-approve for headless)
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
  // Per-build working dir: worktree when isolation ON, else /workspace (default).
  const workdir = resolveBuildWorkdir(params.buildId);
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
    await ensureSandboxNodeUser(containerId);
  } catch {
    // Non-fatal; proceed (some sandboxes may already be correct)
  }

  // BI-C5F9A232: seed dpf-platform skills + global hooks for headless Grok.
  // Best-effort — missing workspace skill pack must not wedge an unrelated auth path.
  try {
    const gov = await ensureSandboxGrokGovernance({ containerId });
    if (!gov.ok) {
      console.warn(
        `[grok-dispatch] governance seed incomplete: plugin=${gov.plugin} hooks=${gov.hooks} detail=${gov.detail ?? ""}`,
      );
    } else {
      console.log(
        `[grok-dispatch] governance seed ok: plugin=${gov.plugin}; ${gov.hooks}`,
      );
    }
  } catch (e) {
    console.warn(`[grok-dispatch] governance seed error: ${(e as Error).message}`);
  }

  let grokAuth: GrokAuthInjection;
  try {
    grokAuth = await ensureGrokAuth(providerId, containerId, safeRunId);
  } catch (err) {
    return {
      content: `Auth error: ${(err as Error).message}`,
      success: false,
      executedTools: [],
      durationMs: 0,
    };
  }

  const instructions = buildGrokInstructions(role, buildContext, priorResults);
  const taskPrompt = buildSpecialistTaskPrompt({ task, instructions });

  const startMs = Date.now();

  try {
    // Write prompt with restrictive perms (0600). Key file was already written 0600 by ensureGrokAuth.
    await writeSandboxFile({ containerId, path: promptFile, content: taskPrompt, mode: "600" });

    const modelFlag = model ? `--model ${model}` : "";

    // Write runner script with trap-based cleanup (critical for concurrent builds + secret hygiene).
    const script = [
      "#!/bin/sh",
      "set -e",
      `cleanup() { rm -f ${promptFile} ${keyFile} ${runnerScript} 2>/dev/null || true; }`,
      "trap cleanup EXIT INT TERM",
      `cd ${workdir}`,
      // OAuth mode: grok reads the ~/.grok/auth.json injected by ensureGrokAuth (no env needed).
      // API-key mode: export XAI_API_KEY from the per-task key file.
      grokAuth.mode === "apikey"
        ? `export XAI_API_KEY=$(cat ${grokAuth.keyFile} 2>/dev/null || echo '')`
        : `: # OAuth credential injected at ~/.grok/auth.json`,
      // Headless single-turn run, verified against grok 0.2.32:
      //  --prompt-file  : read the prompt from a file. `-p/--single` takes a literal prompt
      //                   ARGUMENT (not stdin), so the old `-p - < file` passed "-" as the
      //                   prompt and ignored the file — it never worked.
      //  --always-approve : auto-approve tool executions (unattended build mode).
      // (`--no-auto-update` was removed: it is not a flag in current Grok Build and errored.)
      `grok ${modelFlag} --prompt-file ${promptFile} --always-approve`,
      "cleanup",
    ].join("\n");
    await writeSandboxFile({ containerId, path: runnerScript, content: script, mode: "700" });

    console.log(`[grok-dispatch] Starting task "${task.title}" with Grok ${model || "default"} in ${containerId} (timeout: ${timeoutMs / 1000}s)`);

    // Shared spawn loop — runs as node (parity with Claude), streams stderr for progress.
    const { stdout, durationMs: elapsed } = await runSandboxAgentCli({
      containerId,
      runnerScript,
      timeoutMs,
      asNodeUser: true,
      onStderrLine: (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;

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
      },
    });

    // Refresh durability: persist any token the CLI refreshed during this run so the
    // stored credential stays current across ephemeral build sandboxes (best-effort).
    if (grokAuth.mode === "oauth") {
      await persistRefreshedGrokOAuth(providerId, containerId).catch((e) => {
        console.warn(`[grok-dispatch] could not persist refreshed Grok OAuth token: ${(e as Error).message}`);
      });
    }

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
