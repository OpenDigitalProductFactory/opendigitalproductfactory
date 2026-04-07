// apps/web/lib/integrate/sandbox/build-branch.ts
// Git branch management for isolated builds inside the sandbox container.
//
// Each build gets its own branch: build/<buildId>
// The sandbox container is stateless — if it is running, it is available.
// No slot management, no DB pool, no "in_use" state.
//
// File I/O still uses the shared Docker volume mount (fast, no docker exec).
// Shell commands (prisma migrate, tsc, pnpm build) use docker exec.
// Git branches keep builds isolated and promotion clean.

import { execInSandbox, isSandboxRunning } from "./sandbox";
import { prisma } from "@dpf/db";

const SANDBOX_CONTAINER = process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1";
const SANDBOX_PORT = Number(process.env.SANDBOX_PORT ?? "3035");
const WORKSPACE = "/workspace";

/**
 * Returns true if the sandbox container is running and reachable.
 * Uses a 5-second timeout so the agentic loop fails fast instead of hanging.
 */
export async function isSandboxAvailable(): Promise<boolean> {
  return isSandboxRunning(SANDBOX_CONTAINER).catch(() => false);
}

/**
 * Ensures the sandbox workspace has a git repo and a baseline commit.
 * Safe to call multiple times — no-ops if already initialized.
 */
async function ensureGitBaseline(): Promise<void> {
  const isRepo = await execInSandbox(
    SANDBOX_CONTAINER,
    `git -C ${WORKSPACE} rev-parse --is-inside-work-tree 2>/dev/null && echo yes || echo no`,
  ).catch(() => "no");

  if (isRepo.trim() !== "yes") {
    // First time: init + baseline commit so diffs are clean
    await execInSandbox(
      SANDBOX_CONTAINER,
      [
        `cd ${WORKSPACE}`,
        `git config user.email sandbox@dpf.local`,
        `git config user.name sandbox`,
        `git init`,
        `git add -A -- ':!node_modules' ':!.next' ':!*.tsbuildinfo' ':!pnpm-lock*'`,
        `git commit -m 'sandbox baseline' --allow-empty`,
      ].join(" && "),
    );
    return;
  }

  // Repo exists — ensure there is at least one commit (required for worktrees / branch ops)
  const commitCount = await execInSandbox(
    SANDBOX_CONTAINER,
    `git -C ${WORKSPACE} rev-list --count HEAD 2>/dev/null || echo 0`,
  ).catch(() => "0");

  if (commitCount.trim() === "0") {
    await execInSandbox(
      SANDBOX_CONTAINER,
      [
        `cd ${WORKSPACE}`,
        `git config user.email sandbox@dpf.local`,
        `git config user.name sandbox`,
        `git add -A -- ':!node_modules' ':!.next' ':!*.tsbuildinfo' ':!pnpm-lock*'`,
        `git commit -m 'sandbox baseline' --allow-empty`,
      ].join(" && "),
    );
  }
}

/**
 * Creates (or re-uses) a git branch for this build inside the sandbox.
 * Updates the FeatureBuild record with sandboxId and sandboxPort so that
 * deploy_feature, the preview proxy, and the promoter all work unchanged.
 */
export async function startBuildBranch(buildId: string): Promise<void> {
  await ensureGitBaseline();

  const branchName = `build/${buildId}`;

  // Check if branch already exists
  const branchExists = await execInSandbox(
    SANDBOX_CONTAINER,
    `git -C ${WORKSPACE} branch --list ${branchName} | grep -q . && echo yes || echo no`,
  ).catch(() => "no");

  if (branchExists.trim() === "yes") {
    // Switch to existing branch (resuming a build)
    await execInSandbox(
      SANDBOX_CONTAINER,
      `cd ${WORKSPACE} && git checkout ${branchName}`,
    );
  } else {
    // Create new branch from current HEAD
    await execInSandbox(
      SANDBOX_CONTAINER,
      `cd ${WORKSPACE} && git checkout -b ${branchName}`,
    );
  }

  // Record the sandbox assignment on the build so downstream tools work
  await prisma.featureBuild.update({
    where: { buildId },
    data: {
      sandboxId: SANDBOX_CONTAINER,
      sandboxPort: SANDBOX_PORT,
    },
  });

  console.log(`[build-branch] Build ${buildId} on branch ${branchName} in ${SANDBOX_CONTAINER}`);
}

/**
 * Returns the current git branch inside the sandbox.
 */
export async function currentSandboxBranch(): Promise<string | null> {
  try {
    const out = await execInSandbox(
      SANDBOX_CONTAINER,
      `git -C ${WORKSPACE} rev-parse --abbrev-ref HEAD`,
    );
    return out.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Merges the build branch into main inside the sandbox.
 * Called from the promotion flow after deploy_feature extracts the diff.
 */
export async function promoteBuildBranch(buildId: string): Promise<void> {
  const branchName = `build/${buildId}`;
  const baseBranch = process.env.SANDBOX_BASE_BRANCH ?? "main";

  await execInSandbox(
    SANDBOX_CONTAINER,
    [
      `cd ${WORKSPACE}`,
      `git checkout ${baseBranch}`,
      `git merge --no-ff ${branchName} -m "Merge ${branchName}"`,
    ].join(" && "),
  );

  console.log(`[build-branch] Merged ${branchName} → ${baseBranch}`);
}

/**
 * Switches the sandbox back to main without deleting the build branch.
 * The branch is preserved in git for audit / recovery.
 */
export async function abandonBuildBranch(buildId: string): Promise<void> {
  const baseBranch = process.env.SANDBOX_BASE_BRANCH ?? "main";
  try {
    await execInSandbox(
      SANDBOX_CONTAINER,
      `cd ${WORKSPACE} && git checkout ${baseBranch}`,
    );
    console.log(`[build-branch] Abandoned build/${buildId} — switched back to ${baseBranch}`);
  } catch (err) {
    console.warn(`[build-branch] abandon failed (non-fatal): ${(err as Error).message?.slice(0, 100)}`);
  }
}
