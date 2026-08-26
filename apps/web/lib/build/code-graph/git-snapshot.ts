import { lazyExec, lazyPath, getCwd } from "@/lib/shared/lazy-node";
import { getErrorMessage } from "@/lib/shared/get-error-message";

import {
  buildListTrackedFilesCommand,
  shouldIndexCodeGraphPath,
} from "./path-filter";

const exec = lazyExec();
const GIT_STATUS_TIMEOUT_MS = 2_000;

export function getGitRoot(): string {
  const { resolve } = lazyPath();
  return process.env.PROJECT_ROOT
    ? resolve(process.env.PROJECT_ROOT)
    : resolve(getCwd(), "..", "..");
}


/**
 * Every git invocation is prefixed with `-c safe.directory=<root>`.
 *
 * BI-86EF5900 root cause. The portal container runs as a different uid than the
 * checkout it mounts, so git refuses EVERY command there:
 *
 *   fatal: detected dubious ownership in repository at '/sandbox-workspace'
 *
 * `isGitRepo` caught that and returned false, and reconcile's first guard turns
 * false into `mode: "noop"` — so the code-graph indexer silently did nothing on
 * every scheduled run. Measured live 2026-08-23: graph_node and graph_edge both
 * ZERO for the key while CodeGraphIndexState still read "ready" for 4406 files
 * on a branch last indexed 2026-08-22, the last day git worked.
 *
 * Scoping the exception to the one directory we were told to index is the fix
 * git itself prescribes for this condition, and it is narrower than the
 * `safe.directory=*` wildcard.
 */
function gitIn(gitRoot: string, args: string): string {
  return `git -c safe.directory=${JSON.stringify(gitRoot)} ${args}`;
}

/**
 * Why the working tree could not be read.
 * - `work-tree`  — a real git work tree; index it.
 * - `absent`     — no repository here. Production images ship the built app
 *                  without source; skipping is correct and expected.
 * - `refused`    — a repository IS here and git declined (ownership, perms,
 *                  corruption). NOT the same as absent: skipping silently
 *                  strands the graph forever with no signal, which is how it
 *                  came to be empty while reporting ready.
 */
export type GitRootStatus =
  | { kind: "work-tree" }
  | { kind: "absent"; detail: string }
  | { kind: "refused"; detail: string };

export async function inspectGitRoot(gitRoot: string): Promise<GitRootStatus> {
  try {
    const { stdout } = await exec(gitIn(gitRoot, "rev-parse --is-inside-work-tree"), {
      cwd: gitRoot,
      timeout: 5_000,
    });
    if (stdout.trim() === "true") return { kind: "work-tree" };
    return { kind: "absent", detail: `git did not report a work tree at ${gitRoot}.` };
  } catch (error) {
    const detail = getErrorMessage(error);
    // "not a git repository" is the legitimate production case. Anything else —
    // ownership, permissions, a broken object store — is a fault to surface.
    if (/not a git repository|does not exist|ENOENT/i.test(detail)) {
      return { kind: "absent", detail };
    }
    return { kind: "refused", detail };
  }
}

/**
 * True only for a readable work tree. Retained for callers that just need a
 * boolean; `inspectGitRoot` is the one that distinguishes absent from refused.
 */
export async function isGitRepo(gitRoot: string): Promise<boolean> {
  return (await inspectGitRoot(gitRoot)).kind === "work-tree";
}

export function normalizeGitOutput(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function getCurrentHeadSha(gitRoot: string): Promise<string | null> {
  const { stdout } = await exec(gitIn(gitRoot, "rev-parse HEAD"), { cwd: gitRoot, timeout: 10_000 });
  return stdout.trim() || null;
}

export async function getCurrentBranch(gitRoot: string): Promise<string | null> {
  const { stdout } = await exec(gitIn(gitRoot, "rev-parse --abbrev-ref HEAD"), { cwd: gitRoot, timeout: 10_000 });
  return stdout.trim() || null;
}

export async function isWorkspaceDirty(gitRoot: string): Promise<boolean> {
  try {
    const { stdout } = await exec(gitIn(gitRoot, "status --porcelain"), { cwd: gitRoot, timeout: GIT_STATUS_TIMEOUT_MS });
    return stdout.trim().length > 0;
  } catch {
    // Dirty-state detection is advisory telemetry. If Git status is slow on a
    // host-mounted workspace, keep the graph usable and surface the safer
    // "possibly stale" warning instead of failing the reconcile job.
    return true;
  }
}

export async function listTrackedFiles(gitRoot: string): Promise<string[]> {
  const { stdout } = await exec(buildListTrackedFilesCommand(gitRoot), {
    cwd: gitRoot,
    timeout: 30_000,
    maxBuffer: 1024 * 1024 * 4,
  });
  return normalizeGitOutput(stdout).filter(shouldIndexCodeGraphPath);
}

export async function getChangedFiles(
  gitRoot: string,
  fromSha: string,
  toSha: string,
): Promise<string[]> {
  const { stdout } = await exec(gitIn(gitRoot, `diff --name-only ${fromSha}..${toSha}`), {
    cwd: gitRoot,
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  return normalizeGitOutput(stdout).filter(shouldIndexCodeGraphPath);
}
