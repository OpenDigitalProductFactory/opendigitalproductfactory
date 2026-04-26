import { describe, expect, it } from "vitest";

import {
  buildSandboxGitAddCommand,
  buildSandboxBranchSwitchPrepCommand,
  buildSandboxGitCleanCommand,
  buildSandboxGitCommitPrunedArtifactsCommand,
  buildSandboxGitPruneTrackedArtifactsCommand,
  wrapSandboxGitCommand,
} from "./build-branch";

describe("wrapSandboxGitCommand", () => {
  it("excludes recursive cache and dependency directories from sandbox baseline commits", () => {
    const command = buildSandboxGitAddCommand();
    expect(command).toContain("**/.pnpm-store/**");
    expect(command).toContain("**/.next/**");
    expect(command).toContain("**/node_modules/**");
    expect(command).toContain("**/*.tsbuildinfo");
  });

  it("prunes previously tracked cache artifacts from the sandbox git index", () => {
    const command = buildSandboxGitPruneTrackedArtifactsCommand();
    expect(command).toContain("git rm -r --cached --ignore-unmatch");
    expect(command).toContain(".pnpm-store");
    expect(command).toContain(".next");
    expect(command).toContain("node_modules");
  });

  it("cleans up a stale workspace index lock before running git commands", () => {
    expect(wrapSandboxGitCommand('git -C /workspace status --short')).toContain(
      'rm -f "/workspace/.git/index.lock"',
    );
    expect(wrapSandboxGitCommand('git -C /workspace status --short')).toContain(
      'pgrep -x git',
    );
  });

  it("prefixes sandbox git commands with a safe.directory allowance for /workspace", () => {
    expect(wrapSandboxGitCommand('git -C /workspace status --short')).toContain(
      'git config --global --add safe.directory "/workspace"',
    );
  });

  it("preserves the original command after the safe.directory setup", () => {
    expect(wrapSandboxGitCommand('git -C /workspace checkout "client/abc"')).toMatch(
      /safe\.directory "\/workspace".*git -C \/workspace checkout "client\/abc"/,
    );
  });

  it("stops preview processes and removes app-local next artifacts before switching branches", () => {
    const command = buildSandboxBranchSwitchPrepCommand();

    expect(command).toContain("ss -tlnp");
    expect(command).toContain(":3000");
    expect(command).toContain("kill -9");
    expect(command).toContain('rm -rf /workspace/apps/web/.next');
    expect(command).toContain('/workspace/apps/web/tsconfig.tsbuildinfo');
    expect(command).toContain("/tmp/next-dev.log");
  });

  it("does not preserve .next artifacts when scrubbing the sandbox before checkout", () => {
    const command = buildSandboxGitCleanCommand();

    expect(command).toContain("git clean -fd --");
    expect(command).toContain(":!**/node_modules/**");
    expect(command).toContain(":!**/.pnpm-store/**");
    expect(command).not.toContain(".next");
    expect(command).not.toContain("tsbuildinfo");
  });

  it("commits branch hygiene when tracked generated artifacts are pruned", () => {
    const command = buildSandboxGitCommitPrunedArtifactsCommand("chore: untrack sandbox generated artifacts");

    expect(command).toContain("git rm -r --cached --ignore-unmatch");
    expect(command).toContain("if ! git diff --cached --quiet --exit-code; then git commit -m 'chore: untrack sandbox generated artifacts'; fi");
    expect(command).toContain(".next");
    expect(command).toContain("node_modules");
  });
});
