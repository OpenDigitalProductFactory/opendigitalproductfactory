import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

// Repo root is four levels up from apps/web/lib/githooks/.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const GUARD = path.join(REPO_ROOT, ".githooks/lib/check-root-clone.sh");

const LINKED_WORKTREE_GIT_DIR = "/Users/dev/dpf/.git/worktrees/some-topic";
const PRIMARY_CLONE_GIT_DIR = ".git";

/** Run the guard; return its exit status (0 = allowed, 1 = refused). */
function runGuard(gitDir: string, branch: string, env: Record<string, string> = {}): number {
  try {
    execFileSync("sh", [GUARD, gitDir, branch], {
      env: { ...process.env, DPF_ALLOW_ROOT_CLONE_COMMIT: "", ...env },
      stdio: "pipe",
    });
    return 0;
  } catch (error) {
    return (error as { status?: number }).status ?? -1;
  }
}

describe("check-root-clone guard", () => {
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
