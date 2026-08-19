// apps/web/lib/build/sandbox/agent-cli-runtime.ts
//
// Shared shell for the in-sandbox CLI build agents (claude / codex / grok /
// opencode). Housed WITH the BuildAgentRunner contract (agent-runner-types.ts)
// so the contract — not four near-identical dispatch*.ts files — owns the real
// duplicated mechanics:
//   - the specialist task prompt (role instructions + the CRITICAL monorepo
//     preamble + TASK/FILES/TEST FIRST/VERIFY assembly) — byte-identical across
//     claude/codex/grok per md5;
//   - the `spawn docker exec <runner>` loop: per-task timeout, stdout
//     accumulation, line-by-line stderr (or stdout) progress streaming, and the
//     close/error → {stdout|timedOut|exit} promise;
//   - the catch/timeout/exit-code result-shaping skeleton.
//
// What each surface KEEPS (real protocol differences, supplied via hooks — NOT
// folded away): its auth flow (claude OAuth-refresh / codex auth.json / grok
// auth.json + token write-back / opencode credential-free preflight), the exact
// CLI exec line + flags, temp-file perms (644 vs 600), the user the process runs
// as (`--user node` vs root), its progress-pattern vocabulary, and its result
// parse (claude JSON envelope + cost/usage; opencode JSON-stream + fatal-error
// detection; grok best-effort JSON; codex raw stdout).
//
// Spec: docs/superpowers/specs/2026-06-26-platform-optimization-sweep.md §4.1
// (F-B) — completes AGENTS.md §17 "thin adapters behind a stable contract".

import type { SpecialistRole, AssignedTask } from "../task-dependency-graph";
import { lazyChildProcess, lazyUtil } from "@/lib/shared/lazy-node";

export const SANDBOX_CONTAINER = process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1";

/**
 * Specialist role → build instructions. This record was byte-identical across
 * claude-dispatch / codex-dispatch / grok-dispatch (md5 39953b07…); opencode
 * carried the same four strings with a different surrounding format. Single-
 * sourced here so a wording change lands on every surface at once.
 */
export const SPECIALIST_ROLE_INSTRUCTIONS: Record<SpecialistRole, string> = {
  "data-architect": `You are a data architect working on a Prisma schema.
Key files:
- Schema: packages/db/prisma/schema/ (domain-split *.prisma files)
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

  "documentation-specialist": `You are a documentation specialist closing the docs impact of a DPF change.
Key surfaces:
- Public site: docs/index.html and docs/README.md
- User guide / in-app help: docs/user-guide/
- Architecture and contributor explanation: docs/architecture/ and AGENTS.md
- Coworker-facing behavior: prompts/ and packages/db/data/agent_registry.json when text changes behavior
- Implementation history: docs/superpowers/specs/ and docs/superpowers/plans/
Write for the audience that consumes the change. Use docs/user-guide for operators, docs/architecture for architecture explanation, docs/index.html for pre-install/public positioning, and docs/superpowers for internal design history.
Before finishing, verify changed links where practical and report any large follow-up doc debt as a backlog item instead of burying it in prose.`,

  "qa-engineer": `You are a QA engineer verifying the build.
- Run tests: pnpm exec vitest run --reporter=verbose
- Run typecheck: pnpm exec tsc --noEmit
- Check for runtime errors in the build output
- Report specific failures with file paths and line numbers`,
};

/**
 * Build the role-scoped context preamble (role instructions + PROJECT CONTEXT
 * + optional RESULTS FROM PRIOR TASKS). Surfaces layer their own extra
 * discipline lines on top via `extraDisciplineLines`.
 *
 * @param fallbackInstruction used when the role has no entry (grok/opencode kept
 *   a generic fallback; claude/codex did not — pass undefined to preserve the
 *   stricter behaviour where an unknown role would surface `undefined`).
 */
export function buildSpecialistInstructions(params: {
  role: SpecialistRole;
  buildContext: string;
  priorResults?: string;
  fallbackInstruction?: string;
  extraDisciplineLines?: string[];
}): string {
  const { role, buildContext, priorResults, fallbackInstruction, extraDisciplineLines } = params;
  const parts = [
    SPECIALIST_ROLE_INSTRUCTIONS[role] ?? fallbackInstruction,
    "",
    "PROJECT CONTEXT:",
    buildContext.slice(0, 3000),
  ];
  if (priorResults) {
    parts.push("", "RESULTS FROM PRIOR TASKS:", priorResults.slice(0, 2000));
  }
  if (extraDisciplineLines && extraDisciplineLines.length > 0) {
    parts.push("", ...extraDisciplineLines);
  }
  return parts.join("\n");
}

/**
 * Assemble the full specialist task prompt: the role/context instructions
 * followed by the CRITICAL monorepo preamble and the
 * TASK / implement / FILES / TEST FIRST / VERIFY block. The
 * CRITICAL…VERIFY tail was byte-identical across claude/codex/grok (md5
 * 0f426b2a…); opencode varied only in its `workdir` interpolation, which is why
 * `workdir` is a parameter here.
 */
export function buildSpecialistTaskPrompt(params: {
  task: AssignedTask;
  instructions: string;
  workdir?: string;
}): string {
  const { task, instructions } = params;
  const workdir = params.workdir ?? "/workspace";
  const taskFiles = task.files
    .map((f) => `- ${f.path} (${f.action}): ${f.purpose}`)
    .join("\n");

  return [
    instructions,
    "",
    `CRITICAL: This is a pnpm monorepo. The Next.js app is at apps/web/. All file paths MUST use the full monorepo-relative path (e.g. apps/web/lib/... not lib/..., apps/web/app/... not app/...). The FILES section below has the authoritative paths — use those exactly. Working directory is ${workdir} (the monorepo root).`,
    "",
    `TASK: ${task.title}`,
    "",
    task.task.implement || "",
    "",
    taskFiles ? `FILES (use these exact paths):\n${taskFiles}` : "",
    "",
    task.task.testFirst ? `TEST FIRST: ${task.task.testFirst}` : "",
    task.task.verify ? `VERIFY: ${task.task.verify}` : "",
    "DOCUMENTATION IMPACT CHECK (MANDATORY): Before you report the task done, decide whether this change affects user-facing behavior, coworker behavior, public docs, setup/install/operations, architecture/contributor workflow, prompts, route maps, or external agent behavior. If yes, update the correct human-readable docs in the same diff or report the missing docs as a blocker/follow-up backlog item. If no docs are needed, say why in one sentence. Do not claim done while docs exposed to users, AI coworkers, or opendigitalproductfactory.com are knowingly stale.",
  ].filter(Boolean).join("\n");
}

/** Promisified `exec` over the sandbox container, used by the small write/probe
 *  helpers (auth injection, temp-file writes) in each surface. */
export function sandboxExec(): (cmd: string, opts?: { timeout?: number }) => Promise<{ stdout: string; stderr: string }> {
  const { exec } = lazyChildProcess();
  const { promisify } = lazyUtil();
  return promisify(exec) as (cmd: string, opts?: { timeout?: number }) => Promise<{ stdout: string; stderr: string }>;
}

/**
 * Stream `input` to the stdin of a `docker exec -i` running `innerCommand`
 * inside the sandbox. The payload NEVER enters argv, so a rejected exec, a `ps`
 * / /proc listing, or a container exec log cannot echo it back — the fix for
 * BI-AFEF038A (follow-up to the BI-1291B677 OAuth-token leak) and the same
 * `docker exec -i … base64 -d > file` shape already proven in
 * codex-cli-adapter.ts (BI-2685C1E5). `innerCommand` MUST be secret-free; the
 * real content flows only over stdin.
 *
 * Rejects (secret-free) on spawn error, non-zero exit, or timeout — the error
 * carries stderr/exit code but never `input`.
 */
export function dockerExecWriteStdin(params: {
  containerId: string;
  /** Secret-free `sh -c` payload; reads the real content from stdin. */
  innerCommand: string;
  /** Bytes streamed to the child's stdin — the ONLY channel the content uses. */
  input: string;
  asNodeUser?: boolean;
  timeoutMs?: number;
}): Promise<{ stdout: string; stderr: string }> {
  const { containerId, innerCommand, input, asNodeUser } = params;
  const timeoutMs = params.timeoutMs ?? 5_000;
  const spawn = lazyChildProcess().spawn;
  const args = [
    "exec",
    "-i",
    ...(asNodeUser ? ["--user", "node"] : []),
    containerId,
    "sh",
    "-c",
    innerCommand,
  ];
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const proc = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      settle(() => reject(new Error(`Sandbox file write timed out after ${timeoutMs / 1000}s`)));
    }, timeoutMs);

    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

    // stdin may EPIPE if the container command exits before draining; the close
    // handler owns the real outcome, so a stream-level error is not fatal here.
    proc.stdin?.on("error", () => {});
    proc.stdin?.write(input, (writeErr?: Error | null) => {
      if (writeErr) settle(() => reject(new Error(`Sandbox file write stdin error: ${writeErr.message}`)));
    });
    proc.stdin?.end();

    proc.on("close", (code: number | null) => {
      settle(() => {
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          // NB: never attach `input` — the rejection must stay secret-free.
          reject(Object.assign(new Error(`Sandbox file write failed (exit ${code ?? "?"}): ${stderr.slice(0, 200)}`), { code }));
        }
      });
    });

    proc.on("error", (err: Error) => {
      settle(() => reject(err));
    });
  });
}

/**
 * Write `content` to `path` inside the sandbox via a base64 round-trip (avoids
 * all shell-escaping issues), chmod it, and optionally run as the `node` user.
 * This is the temp-file / runner-script write every surface repeats; perms and
 * the exec user stay caller-controlled because they are a real per-surface
 * choice (644 readable prompt vs 600 secret; root vs node).
 *
 * SECURITY (BI-AFEF038A): the base64 payload is streamed via the child's stdin,
 * NOT embedded in the `docker exec` command. When `content` is a secret (OAuth
 * token, JWT, codex auth.json) it therefore never appears in argv, a process
 * listing, or an exec log, and a rejected write cannot echo it into an error.
 * The target `path` (and any `mkdirParents`) are single-quoted so a path can
 * never break out of the `sh -c` command either.
 */
export async function writeSandboxFile(params: {
  containerId: string;
  path: string;
  content: string;
  /** chmod to apply after writing (e.g. "644", "600", "755", "700"). Omit to
   *  leave the file at its default umask perms — codex's auth.json is written
   *  without an explicit chmod and that exact behaviour is preserved by omitting
   *  this. */
  mode?: string;
  asNodeUser?: boolean;
  /** `chown node:node <path>` after writing (root-written file the node-user CLI
   *  must read, e.g. the per-call mcp-config). */
  chownNodeUser?: boolean;
  timeoutMs?: number;
  mkdirParents?: string;   // optional `mkdir -p <dir> &&` prefix target
}): Promise<void> {
  const { containerId, path, content, mode, asNodeUser, chownNodeUser, mkdirParents } = params;
  const b64 = Buffer.from(content).toString("base64");
  const mkdir = mkdirParents ? `mkdir -p '${mkdirParents}' && ` : "";
  const chown = chownNodeUser ? ` && chown node:node '${path}'` : "";
  const chmod = mode ? ` && chmod ${mode} '${path}'` : "";
  // Content flows over stdin (see dockerExecWriteStdin); the command string is
  // secret-free. `base64 -d` reads the payload from stdin when given no file arg.
  await dockerExecWriteStdin({
    containerId,
    innerCommand: `${mkdir}base64 -d > '${path}'${chown}${chmod}`,
    input: b64,
    asNodeUser,
    timeoutMs: params.timeoutMs ?? 5_000,
  });
}

/** Ensure /workspace is writable by the node user (uid 1000) and git is
 *  configured for it. Mirrors the prep the node-user CLI surfaces (claude /
 *  grok / opencode) each repeated; codex deliberately does NOT call this (it
 *  runs as root), so it is a hook, not part of the base loop. */
export async function ensureSandboxNodeUser(containerId: string): Promise<void> {
  await sandboxExec()(
    `docker exec ${containerId} sh -c "chown -R node:node /workspace && su -s /bin/sh node -c 'git config --global user.email sandbox@dpf.local && git config --global user.name DPF-Sandbox' 2>/dev/null || true"`,
    { timeout: 15_000 },
  );
}

export type SandboxCliRunResult = {
  stdout: string;
  stderr: string;
  durationMs: number;
  exitCode: number | null;
};

/**
 * The shared `spawn docker exec <runner-script>` loop. This is the block that
 * was duplicated ~4×: start a per-task timeout, accumulate stdout, iterate
 * stderr (and optionally stdout) line-by-line for progress, and resolve/reject
 * on close.
 *
 * Resolution policy: by default a run resolves when `exitCode === 0` OR stdout
 * is non-empty (claude / grok / opencode), and rejects otherwise with the
 * captured stdout/stderr/code attached. Set `resolveOnlyOnZeroExit` for codex,
 * which resolves on close regardless of code and lets the caller branch on
 * `exitCode`. On timeout the promise rejects with `killed: true` and the partial
 * stdout attached.
 *
 * Auth injection, temp-file writes, and the runner-script authoring happen in
 * the caller BEFORE this runs — this owns only the spawn/stream/shape loop.
 */
export function runSandboxAgentCli(params: {
  containerId: string;
  /** The runner-script path to `docker exec`. Most surfaces author a `/tmp/*-run.sh`
   *  script and pass it here. Mutually exclusive with `execArgs`. */
  runnerScript?: string;
  /** Full `docker <args>` override for surfaces that invoke an inline command
   *  (codex uses `exec <container> sh -c "cd … && codex exec … < prompt"`) rather
   *  than a runner script. When set, `runnerScript`/`asNodeUser` are ignored. */
  execArgs?: string[];
  timeoutMs: number;
  asNodeUser?: boolean;
  resolveOnlyOnZeroExit?: boolean;
  onStderrLine?: (line: string) => void;
  onStdoutChunk?: (chunk: string) => void;
}): Promise<SandboxCliRunResult> {
  const {
    containerId,
    runnerScript,
    timeoutMs,
    asNodeUser,
    resolveOnlyOnZeroExit,
    onStderrLine,
    onStdoutChunk,
  } = params;
  const spawnCb = lazyChildProcess().spawn;
  const startMs = Date.now();

  const execArgs = params.execArgs
    ?? (asNodeUser
      ? ["exec", "--user", "node", containerId, runnerScript!]
      : ["exec", containerId, runnerScript!]);

  return new Promise<SandboxCliRunResult>((resolve, reject) => {
    const proc = spawnCb("docker", execArgs);

    let stdout = "";
    let stderrBuf = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
    }, timeoutMs);

    proc.stdout.on("data", (data: Buffer) => {
      const chunk = data.toString();
      stdout += chunk;
      onStdoutChunk?.(chunk);
    });

    proc.stderr.on("data", (data: Buffer) => {
      const chunk = data.toString();
      stderrBuf += chunk;
      if (onStderrLine) {
        for (const line of chunk.split("\n")) {
          if (line) onStderrLine(line);
        }
      }
    });

    proc.on("close", (code: number | null) => {
      clearTimeout(timer);
      const durationMs = Date.now() - startMs;
      if (timedOut) {
        reject(Object.assign(new Error(`Timed out after ${timeoutMs / 1000}s`), { stdout, stderr: stderrBuf, killed: true }));
        return;
      }
      if (resolveOnlyOnZeroExit) {
        // Codex: resolve regardless of code; caller branches on exitCode.
        resolve({ stdout, stderr: stderrBuf, durationMs, exitCode: code });
        return;
      }
      if (code === 0 || stdout.trim()) {
        resolve({ stdout, stderr: stderrBuf, durationMs, exitCode: code });
      } else {
        reject(Object.assign(new Error(`Exit code ${code}`), { stdout, stderr: stderrBuf, code }));
      }
    });

    proc.on("error", (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
