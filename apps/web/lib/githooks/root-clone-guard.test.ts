import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

// Repo root is four levels up from apps/web/lib/githooks/.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const GUARD = path.join(REPO_ROOT, ".githooks/lib/check-root-clone.sh");

const LINKED_WORKTREE_GIT_DIR = "/Users/dev/dpf/.git/worktrees/some-topic";
const PRIMARY_CLONE_GIT_DIR = ".git";

type GuardShell = {
  command: string;
  guardPath: string;
};

function commandWorks(command: string, args: string[]): boolean {
  const result = spawnSync(command, args, { stdio: "ignore" });
  return result.status === 0;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function shellAssignments(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([name, value]) => `${name}=${shellQuote(value)}`)
    .join(" ");
}

function toWslPath(value: string): string | null {
  const normalized = value.replace(/\\/g, "/");
  const match = normalized.match(/^([A-Za-z]):\/(.*)$/);
  if (!match) return null;
  return `/mnt/${match[1].toLowerCase()}/${match[2]}`;
}

function resolveGuardShell(): GuardShell | null {
  if (commandWorks("sh", ["-c", "exit 0"])) {
    return { command: "sh", guardPath: GUARD };
  }
  if (!commandWorks("bash", ["-lc", "exit 0"])) {
    return null;
  }

  const candidates = process.platform === "win32"
    ? [toWslPath(GUARD), GUARD.replace(/\\/g, "/")].filter((candidate): candidate is string => Boolean(candidate))
    : [GUARD];

  const guardPath = candidates.find((candidate) =>
    commandWorks("bash", ["-lc", `test -f ${shellQuote(candidate)}`]),
  );
  return guardPath ? { command: "bash", guardPath } : null;
}

const GUARD_SHELL = resolveGuardShell();
const describeWithPosixShell = GUARD_SHELL ? describe : describe.skip;

/** Run the guard; return its exit status (0 = allowed, 1 = refused). */
function runGuard(gitDir: string, branch: string, env: Record<string, string> = {}): number {
  if (!GUARD_SHELL) return -1;
  const guardEnv = { DPF_ALLOW_ROOT_CLONE_COMMIT: "", ...env };
  try {
    if (GUARD_SHELL.command === "bash" && process.platform === "win32") {
      execFileSync("bash", [
        "-lc",
        `${shellAssignments(guardEnv)} ${shellQuote(GUARD_SHELL.guardPath)} ${shellQuote(gitDir)} ${shellQuote(branch)}`,
      ], {
        env: process.env,
        stdio: "pipe",
      });
    } else {
      execFileSync(GUARD_SHELL.command, [GUARD_SHELL.guardPath, gitDir, branch], {
        env: { ...process.env, ...guardEnv },
        stdio: "pipe",
      });
    }
    return 0;
  } catch (error) {
    return (error as { status?: number }).status ?? -1;
  }
}

describeWithPosixShell("check-root-clone guard", () => {
  it("allows feature-branch commits in a linked worktree", () => {
    expect(runGuard(LINKED_WORKTREE_GIT_DIR, "feat/something")).toBe(0);
  });

  it("refuses a feature-branch commit in the primary clone", () => {
    expect(runGuard(PRIMARY_CLONE_GIT_DIR, "feat/something")).toBe(1);
  });

  it("refuses every feature-class prefix in the primary clone", () => {
    for (const branch of ["feat/a", "fix/b", "chore/c", "doc/d", "clean/e"]) {
      expect(runGuard(PRIMARY_CLONE_GIT_DIR, branch)).toBe(1);
    }
  });

  it("allows main (and other non-feature branches) in the primary clone", () => {
    expect(runGuard(PRIMARY_CLONE_GIT_DIR, "main")).toBe(0);
    expect(runGuard(PRIMARY_CLONE_GIT_DIR, "release/5.6")).toBe(0);
  });

  it("allows detached HEAD (empty branch) in the primary clone (rebase/merge)", () => {
    expect(runGuard(PRIMARY_CLONE_GIT_DIR, "")).toBe(0);
  });

  it("honors the DPF_ALLOW_ROOT_CLONE_COMMIT override", () => {
    expect(
      runGuard(PRIMARY_CLONE_GIT_DIR, "feat/something", { DPF_ALLOW_ROOT_CLONE_COMMIT: "1" }),
    ).toBe(0);
  });
});
