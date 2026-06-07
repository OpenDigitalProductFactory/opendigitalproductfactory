import { execFile } from "node:child_process";
import { existsSync as nodeExistsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface EnvLike {
  [key: string]: string | undefined;
  DPF_MANAGED_SCRIPT_DIR?: string;
  PROJECT_ROOT?: string;
}

interface ResolveManagedScriptPathOptions {
  env?: EnvLike;
  existsSync?: (candidate: string) => boolean;
}

function normalizeRoot(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\\/g, "/").replace(/\/+$/, "");
}

function pushUnique(roots: string[], candidate: string | null): void {
  if (!candidate || roots.includes(candidate)) return;
  roots.push(candidate);
}

export function managedScriptRootCandidates(env: EnvLike = process.env): string[] {
  const roots: string[] = [];
  const projectRoot = normalizeRoot(env.PROJECT_ROOT) ?? "/workspace";

  pushUnique(roots, normalizeRoot(env.DPF_MANAGED_SCRIPT_DIR));
  pushUnique(roots, "/app/scripts");
  pushUnique(roots, path.posix.join(projectRoot, "scripts"));
  pushUnique(roots, "/workspace/scripts");
  pushUnique(roots, "/host-dpf/scripts");

  return roots;
}

export function resolveManagedScriptPath(
  scriptName: string,
  options?: ResolveManagedScriptPathOptions,
): string {
  const roots = managedScriptRootCandidates(options?.env ?? process.env);
  const existsSync = options?.existsSync ?? nodeExistsSync;

  for (const root of roots) {
    const candidate = path.posix.join(root, scriptName);
    if (existsSync(candidate)) return candidate;
  }

  return path.posix.join(roots[0] ?? "/app/scripts", scriptName);
}

export interface ManagedScriptOutcome {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RunManagedScriptOptions {
  env?: NodeJS.ProcessEnv;
  /** Hard wall-clock cap in ms. Omit for no timeout. */
  timeoutMs?: number;
  /** Override the stdout/stderr capture ceiling (default 8 MiB). */
  maxBuffer?: number;
}

const DEFAULT_MANAGED_SCRIPT_MAX_BUFFER = 8 * 1024 * 1024;

/**
 * Run a managed shell script through the `/bin/sh` interpreter rather than
 * executing the file path directly.
 *
 * WHY `/bin/sh <script>` and not `execFile(<script>)`:
 *   execFile(path) requires the file to carry the Unix executable bit. The DPF
 *   repo is developed on Windows, where git cannot preserve that bit, so the
 *   backup/restore scripts are committed as mode 0644; the runtime Docker image
 *   then COPYs them without a chmod. A direct exec therefore dies with
 *   `spawn EACCES`, which the runners surfaced as the opaque "runner exited -1"
 *   and which aborted the pre-upgrade recovery point (incident 2026-06-06:
 *   recovery-point-failed across postgres/neo4j/qdrant in <25ms each).
 *
 *   Every managed script begins with `#!/bin/sh`, so `sh <script>` is
 *   semantically identical and removes the executable-bit dependency entirely.
 *   It also makes a missing script legible (sh exits 2 "can't open …") instead
 *   of an EACCES that maps to a meaningless -1.
 *
 * This is the single chokepoint for invoking managed scripts: any new runner
 * MUST go through here so the invariant cannot regress per-call-site.
 */
export async function runManagedScript(
  scriptPath: string,
  options: RunManagedScriptOptions = {},
): Promise<ManagedScriptOutcome> {
  try {
    const { stdout, stderr } = await execFileAsync("/bin/sh", [scriptPath], {
      env: options.env ?? process.env,
      timeout: options.timeoutMs,
      maxBuffer: options.maxBuffer ?? DEFAULT_MANAGED_SCRIPT_MAX_BUFFER,
    });
    return { ok: true, stdout, stderr, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      signal?: string;
      message?: string;
    };
    // Numeric code = the script ran and exited non-zero. A string code
    // (e.g. "ENOENT" if /bin/sh itself is missing) is a spawn-level failure;
    // make it legible rather than collapsing to -1 with no context.
    const exitCode = typeof e.code === "number" ? e.code : -1;
    const spawnHint =
      typeof e.code === "string"
        ? `cannot launch managed script ${scriptPath}: ${e.code}`
        : undefined;
    return {
      ok: false,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? spawnHint ?? e.message ?? String(err),
      exitCode,
    };
  }
}
