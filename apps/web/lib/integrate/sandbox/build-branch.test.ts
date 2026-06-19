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
  getClientIdentity,
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

  it("commits branch hygiene when tracked generated artifacts are pruned", () => {
    const command = buildSandboxGitCommitPrunedArtifactsCommand("chore: untrack sandbox generated artifacts");

    expect(command).toContain("git rm -r --cached --ignore-unmatch");
    expect(command).toContain("if ! git diff --cached --quiet --exit-code; then git commit -m 'chore: untrack sandbox generated artifacts'; fi");
    expect(command).toContain(".next");
    expect(command).toContain("node_modules");
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
