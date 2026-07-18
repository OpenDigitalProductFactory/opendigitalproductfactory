import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: { platformDevConfig: { findUnique: vi.fn() } },
}));

import {
  buildSandboxGitAddCommand,
  buildSandboxBranchSwitchPrepCommand,
  buildSandboxGitCleanCommand,
  buildSandboxCommitInFlightWorkCommand,
  buildSandboxGitCommitPrunedArtifactsCommand,
  buildSandboxGitPruneTrackedArtifactsCommand,
  buildWorktreePath,
  buildSandboxWorktreeAddCommand,
  buildSandboxWorktreeRemoveCommand,
  BUILD_WORKTREE_ROOT_SEGMENT,
  isBuildWorktreeIsolationEnabled,
  resolveBuildWorkdir,
  getClientIdentity,
  wrapSandboxGitCommand,
} from "./build-branch";
import { shouldPreserveBuildBranchWork } from "./sandbox-source-currency";

describe("wrapSandboxGitCommand", () => {
  it("excludes recursive cache and dependency directories from sandbox baseline commits", () => {
    const command = buildSandboxGitAddCommand();
    expect(command).toContain("**/.pnpm-store/**");
    expect(command).toContain("**/.next/**");
    expect(command).toContain("**/node_modules/**");
    expect(command).toContain("**/*.tsbuildinfo");
  });

  it("stages baseline files without git add -A so ignored caches do not fail the build start", () => {
    const command = buildSandboxGitAddCommand();

    expect(command).toContain("git add -u");
    expect(command).toContain("git ls-files -z --others --exclude-standard -- .");
    expect(command).toContain("xargs -0 -r git add --");
    expect(command).not.toContain("git add -A");
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

  it("exempts in-sandbox commits from the host-oriented root-clone pre-commit guard", () => {
    // The sandbox /workspace is the build tree, not the host merge/release clone
    // the root-clone guard protects. Without this override a baseline/build
    // commit silently fails start_build whenever the sandbox sits on a
    // feat/*|fix/*|… branch (BI-98B723C0 — observed live blocking a re-dispatch).
    expect(wrapSandboxGitCommand('git -C /workspace commit -m "sandbox baseline"')).toContain(
      "export DPF_ALLOW_ROOT_CLONE_COMMIT=1",
    );
  });

  it("exempts in-sandbox commits from the pre-commit typecheck (stale-Prisma / out-of-scope false positives)", () => {
    // The sandbox is the build tree, not a dev clone. Its pre-commit typecheck
    // runs against a stale/junctioned Prisma client + other pre-existing,
    // out-of-scope errors that have nothing to do with the build's own diff;
    // those false positives rejected the mechanical `sandbox baseline` commit
    // and blocked startBuildBranch for the whole fleet. The build's real
    // typecheck is the review-phase SCOPED verification + CI on the PR.
    expect(wrapSandboxGitCommand('git -C /workspace commit -m "sandbox baseline"')).toContain(
      "export DPF_SKIP_TYPECHECK=1",
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

  it("commits a build branch's in-flight work before the pre-checkout scrub (BI-98B723C0)", () => {
    const command = buildSandboxCommitInFlightWorkCommand();

    // Acts ONLY on a build/* branch — never client/<id> or a baseline.
    expect(command).toContain("git rev-parse --abbrev-ref HEAD");
    expect(command).toContain("grep -q '^build/'");
    // Stages source via the shared add command (which excludes generated/cache).
    expect(command).toContain("git add -u");
    expect(command).toContain(":!**/node_modules/**");
    // Commits only when there are staged changes; best-effort so a no-op never blocks.
    expect(command).toContain("git diff --cached --quiet --exit-code");
    expect(command).toContain("wip: preserve in-flight build work before branch switch");
  });

  // BI-8C6AA60E — review-phase start_build must not hard-reset a build branch
  // that already carries generated code (commitsAhead / source delta / dirty).
  describe("shouldPreserveBuildBranchWork (BI-8C6AA60E)", () => {
    it("preserves when the build branch is ahead of the client fork", () => {
      expect(
        shouldPreserveBuildBranchWork({
          status: "ahead",
          aheadBy: 2,
          localSourceChangeCount: 3,
          dirty: false,
        }),
      ).toBe(true);
    });

    it("preserves when source deltas exist even if status is classified as behind", () => {
      // Defensive: misclassified currency must not wipe real source.
      expect(
        shouldPreserveBuildBranchWork({
          status: "behind",
          aheadBy: 0,
          localSourceChangeCount: 5,
          dirty: false,
        }),
      ).toBe(true);
    });

    it("preserves dirty working trees", () => {
      expect(
        shouldPreserveBuildBranchWork({
          status: "dirty",
          aheadBy: 0,
          localSourceChangeCount: 0,
          dirty: true,
        }),
      ).toBe(true);
    });

    it("preserves diverged branches (never hard-reset away real work)", () => {
      expect(
        shouldPreserveBuildBranchWork({
          status: "diverged",
          aheadBy: 1,
          localSourceChangeCount: 2,
          dirty: false,
        }),
      ).toBe(true);
    });

    it("allows hard-reset only when the branch has no local work", () => {
      expect(
        shouldPreserveBuildBranchWork({
          status: "behind",
          aheadBy: 0,
          localSourceChangeCount: 0,
          dirty: false,
        }),
      ).toBe(false);
      expect(
        shouldPreserveBuildBranchWork({
          status: "current",
          aheadBy: 0,
          localSourceChangeCount: 0,
          dirty: false,
        }),
      ).toBe(false);
    });
  });

  it("commits branch hygiene when tracked generated artifacts are pruned", () => {
    const command = buildSandboxGitCommitPrunedArtifactsCommand("chore: untrack sandbox generated artifacts");

    expect(command).toContain("git rm -r --cached --ignore-unmatch");
    expect(command).toContain("if ! git diff --cached --quiet --exit-code; then git commit -m 'chore: untrack sandbox generated artifacts'; fi");
    expect(command).toContain(".next");
    expect(command).toContain("node_modules");
  });
});

// ─── Per-build worktree primitives (BI-98B723C0 Phase 2) ─────────────────────

describe("per-build worktree primitives (BI-98B723C0 Phase 2)", () => {
  it("derives a per-build worktree path under the .builds root", () => {
    expect(BUILD_WORKTREE_ROOT_SEGMENT).toBe(".builds");
    expect(buildWorktreePath("FB-ABCD1234")).toBe("/workspace/.builds/FB-ABCD1234");
    // honors a non-default workspace so the path can be threaded per dispatcher
    expect(buildWorktreePath("FB-ABCD1234", "/ws")).toBe("/ws/.builds/FB-ABCD1234");
  });

  it("creates an isolated worktree on the build branch with shared node_modules symlinks", () => {
    const cmd = buildSandboxWorktreeAddCommand("FB-ABCD1234", "build/FB-ABCD1234");
    // idempotent: clears any stale worktree first, then prunes the registry
    expect(cmd).toContain(
      "git worktree remove --force /workspace/.builds/FB-ABCD1234 2>/dev/null || true",
    );
    expect(cmd).toContain("git worktree prune");
    // attaches the build branch into the worktree
    expect(cmd).toContain(
      "git worktree add --force /workspace/.builds/FB-ABCD1234 build/FB-ABCD1234",
    );
    // node_modules shared by symlink — NOT reinstalled (verified live in dpf-sandbox-1)
    expect(cmd).toContain(
      "ln -s /workspace/node_modules /workspace/.builds/FB-ABCD1234/node_modules",
    );
    expect(cmd).toContain(
      "ln -s /workspace/apps/web/node_modules /workspace/.builds/FB-ABCD1234/apps/web/node_modules",
    );
    expect(cmd).toContain(
      "ln -s /workspace/packages/db/node_modules /workspace/.builds/FB-ABCD1234/packages/db/node_modules",
    );
    // never runs an install in the worktree — the symlinks are the whole point
    expect(cmd).not.toContain("pnpm install");
  });

  it("tears down a build's worktree best-effort without touching the shared install", () => {
    const cmd = buildSandboxWorktreeRemoveCommand("FB-ABCD1234");
    expect(cmd).toContain(
      "git worktree remove --force /workspace/.builds/FB-ABCD1234 2>/dev/null || true",
    );
    expect(cmd).toContain("git worktree prune");
    // teardown must not rm -rf anything — node_modules are symlinks, removal is git's job
    expect(cmd).not.toContain("rm -rf");
  });

  it("defaults isolation ON — resolveBuildWorkdir returns the per-build worktree", () => {
    const prev = process.env.DPF_BUILD_WORKTREE_ISOLATION;
    delete process.env.DPF_BUILD_WORKTREE_ISOLATION;
    try {
      expect(isBuildWorktreeIsolationEnabled()).toBe(true);
      expect(resolveBuildWorkdir("FB-ABCD1234")).toBe("/workspace/.builds/FB-ABCD1234");
    } finally {
      if (prev === undefined) delete process.env.DPF_BUILD_WORKTREE_ISOLATION;
      else process.env.DPF_BUILD_WORKTREE_ISOLATION = prev;
    }
  });

  it("can still opt out to the shared workspace for emergency rollback", () => {
    const prev = process.env.DPF_BUILD_WORKTREE_ISOLATION;
    try {
      for (const value of ["0", "false", "off"]) {
        process.env.DPF_BUILD_WORKTREE_ISOLATION = value;
        expect(isBuildWorktreeIsolationEnabled()).toBe(false);
        expect(resolveBuildWorkdir("FB-ABCD1234")).toBe("/workspace");
      }
    } finally {
      if (prev === undefined) delete process.env.DPF_BUILD_WORKTREE_ISOLATION;
      else process.env.DPF_BUILD_WORKTREE_ISOLATION = prev;
    }
  });

  it("treats explicit truthy values as isolation enabled", () => {
    const prev = process.env.DPF_BUILD_WORKTREE_ISOLATION;
    process.env.DPF_BUILD_WORKTREE_ISOLATION = "1";
    try {
      expect(isBuildWorktreeIsolationEnabled()).toBe(true);
      expect(resolveBuildWorkdir("FB-ABCD1234")).toBe("/workspace/.builds/FB-ABCD1234");
    } finally {
      if (prev === undefined) delete process.env.DPF_BUILD_WORKTREE_ISOLATION;
      else process.env.DPF_BUILD_WORKTREE_ISOLATION = prev;
    }
  });
});

// ─── Sandbox git-add exclusions (generated Prisma client) ────────────────────

describe("buildSandboxGitAddCommand generated-client exclusion", () => {
  it("excludes the generated Prisma client from sandbox staged changes", () => {
    const command = buildSandboxGitAddCommand();
    // The generated Prisma client lives at packages/db/generated/ — it must
    // never appear in the diff baseline because a stale sandbox image will
    // produce the wrong types and bloat the patch with conflicts.
    expect(command).toContain("**/generated/client/**");
  });
});

// ─── Client identity upstream default (BI-5F288AAA) ──────────────────────────

describe("getClientIdentity upstream default", () => {
  it("defaults upstreamRemoteUrl to the canonical Hive repo when PlatformDevConfig.upstreamRemoteUrl is null", async () => {
    const { prisma } = (await import("@dpf/db")) as unknown as {
      prisma: { platformDevConfig: { findUnique: ReturnType<typeof vi.fn> } };
    };
    prisma.platformDevConfig.findUnique.mockResolvedValue({
      clientId: "client-test",
      gitAgentEmail: "agent-abc12345@dpf.local",
      upstreamRemoteUrl: null,
    });

    const identity = await getClientIdentity();

    // Without this default the sandbox bootstrap skips the origin/main baseline
    // reset (build-branch.ts ensureGitBaseline) and creates a synthetic-root
    // repo with no merge-base against origin/main — which blocks every hive
    // contribution at the source_currency readiness gate (BI-5F288AAA).
    expect(identity.upstreamRemoteUrl).toBe(
      "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory.git",
    );
  });
});
