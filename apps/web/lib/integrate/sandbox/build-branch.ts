// apps/web/lib/integrate/sandbox/build-branch.ts
// Git branch management for isolated builds inside the sandbox container.
//
// Branch model (10,000-client hive):
//   client/<clientId>   — persistent per-install branch, never deleted
//       └── build/<buildId>  — per-feature branch, merges into client/<clientId> on promotion
//
// Git author identity:
//   name:  dpf-agent                              (identical across all installs)
//   email: agent-<sha256(clientId)[:16]>@hive.dpf (unique per install, anonymous)
//
// This makes every client's contributions indistinguishable by name in the
// upstream log but traceable and conflict-free by email. The hash cannot be
// reversed to identify the client or their organization.

import { execInSandbox, isSandboxRunning } from "./sandbox";
import { prisma } from "@dpf/db";

const SANDBOX_CONTAINER = process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1";
const SANDBOX_PORT = Number(process.env.SANDBOX_PORT ?? "3035");
const WORKSPACE = "/workspace";

// ─── Client Identity ─────────────────────────────────────────────────────────

type ClientIdentity = {
  clientId: string;
  gitAgentEmail: string;
  clientBranch: string; // "client/<clientId>"
};

let _cachedIdentity: ClientIdentity | null = null;

/**
 * Returns the stable client identity from PlatformDevConfig.
 * Cached in memory after first read — identity never changes.
 */
export async function getClientIdentity(): Promise<ClientIdentity> {
  if (_cachedIdentity) return _cachedIdentity;

  const config = await prisma.platformDevConfig.findUnique({
    where: { id: "singleton" },
    select: { clientId: true, gitAgentEmail: true },
  });

  if (!config?.clientId || !config?.gitAgentEmail) {
    throw new Error(
      "Client identity not initialized. Re-run the seed: docker compose restart portal-init"
    );
  }

  _cachedIdentity = {
    clientId: config.clientId,
    gitAgentEmail: config.gitAgentEmail,
    clientBranch: `client/${config.clientId}`,
  };

  return _cachedIdentity;
}

// ─── Sandbox Availability ─────────────────────────────────────────────────────

/**
 * Returns true if the sandbox container is running and reachable.
 * 5-second timeout — fails fast instead of hanging the agentic loop.
 */
export async function isSandboxAvailable(): Promise<boolean> {
  return isSandboxRunning(SANDBOX_CONTAINER).catch(() => false);
}

// ─── Git Baseline ────────────────────────────────────────────────────────────

/**
 * Configures git identity and ensures a baseline commit exists.
 * Safe to call multiple times.
 */
async function ensureGitBaseline(identity: ClientIdentity): Promise<void> {
  // Configure identity first (idempotent)
  await execInSandbox(
    SANDBOX_CONTAINER,
    [
      `git -C ${WORKSPACE} config user.name "dpf-agent"`,
      `git -C ${WORKSPACE} config user.email "${identity.gitAgentEmail}"`,
    ].join(" && "),
  ).catch(() => {});

  const isRepo = await execInSandbox(
    SANDBOX_CONTAINER,
    `git -C ${WORKSPACE} rev-parse --is-inside-work-tree 2>/dev/null && echo yes || echo no`,
  ).catch(() => "no");

  if (isRepo.trim() !== "yes") {
    await execInSandbox(
      SANDBOX_CONTAINER,
      [
        `cd ${WORKSPACE}`,
        `git init`,
        `git config user.name "dpf-agent"`,
        `git config user.email "${identity.gitAgentEmail}"`,
        `git add -A -- ':!node_modules' ':!.next' ':!*.tsbuildinfo' ':!pnpm-lock*'`,
        `git commit -m 'sandbox baseline' --allow-empty`,
      ].join(" && "),
    );
    return;
  }

  // Ensure at least one commit exists
  const commitCount = await execInSandbox(
    SANDBOX_CONTAINER,
    `git -C ${WORKSPACE} rev-list --count HEAD 2>/dev/null || echo 0`,
  ).catch(() => "0");

  if (commitCount.trim() === "0") {
    await execInSandbox(
      SANDBOX_CONTAINER,
      [
        `cd ${WORKSPACE}`,
        `git config user.name "dpf-agent"`,
        `git config user.email "${identity.gitAgentEmail}"`,
        `git add -A -- ':!node_modules' ':!.next' ':!*.tsbuildinfo' ':!pnpm-lock*'`,
        `git commit -m 'sandbox baseline' --allow-empty`,
      ].join(" && "),
    );
  }
}

/**
 * Ensures the persistent client branch exists.
 * Creates it from HEAD if missing.
 */
async function ensureClientBranch(identity: ClientIdentity): Promise<void> {
  const exists = await execInSandbox(
    SANDBOX_CONTAINER,
    `git -C ${WORKSPACE} branch --list "${identity.clientBranch}" | grep -q . && echo yes || echo no`,
  ).catch(() => "no");

  if (exists.trim() !== "yes") {
    await execInSandbox(
      SANDBOX_CONTAINER,
      `git -C ${WORKSPACE} checkout -b "${identity.clientBranch}"`,
    );
    console.log(`[build-branch] Created persistent client branch: ${identity.clientBranch}`);
  }
}

// ─── Build Branch Lifecycle ──────────────────────────────────────────────────

/**
 * Creates (or re-uses) a build branch for this feature.
 * Branch is forked from the client branch: client/<clientId>
 * Updates FeatureBuild with sandboxId/sandboxPort so deploy_feature,
 * the preview proxy, and the promoter all work unchanged.
 */
export async function startBuildBranch(buildId: string): Promise<void> {
  const identity = await getClientIdentity();

  await ensureGitBaseline(identity);
  await ensureClientBranch(identity);

  // Switch to client branch before forking the build branch
  await execInSandbox(
    SANDBOX_CONTAINER,
    `git -C ${WORKSPACE} checkout "${identity.clientBranch}"`,
  );

  const branchName = `build/${buildId}`;

  const branchExists = await execInSandbox(
    SANDBOX_CONTAINER,
    `git -C ${WORKSPACE} branch --list "${branchName}" | grep -q . && echo yes || echo no`,
  ).catch(() => "no");

  if (branchExists.trim() === "yes") {
    await execInSandbox(
      SANDBOX_CONTAINER,
      `git -C ${WORKSPACE} checkout "${branchName}"`,
    );
    console.log(`[build-branch] Resumed build branch: ${branchName}`);
  } else {
    await execInSandbox(
      SANDBOX_CONTAINER,
      `git -C ${WORKSPACE} checkout -b "${branchName}"`,
    );
    console.log(`[build-branch] Created build branch: ${branchName} from ${identity.clientBranch}`);
  }

  await prisma.featureBuild.update({
    where: { buildId },
    data: {
      sandboxId: SANDBOX_CONTAINER,
      sandboxPort: SANDBOX_PORT,
      buildBranch: branchName,
    },
  });
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
 * Merges the build branch into the client branch after promotion.
 * The client branch accumulates all promoted features.
 * Upstream contribution (client/<id> → upstream main) is a separate step.
 */
export async function promoteBuildBranch(buildId: string): Promise<void> {
  const identity = await getClientIdentity();
  const branchName = `build/${buildId}`;

  await execInSandbox(
    SANDBOX_CONTAINER,
    [
      `cd ${WORKSPACE}`,
      `git checkout "${identity.clientBranch}"`,
      `git merge --no-ff "${branchName}" -m "feat: promote ${branchName}"`,
    ].join(" && "),
  );

  console.log(`[build-branch] Promoted ${branchName} → ${identity.clientBranch}`);
}

/**
 * Switches the sandbox back to the client branch without deleting the build branch.
 * The build branch is preserved in git for audit / recovery.
 */
export async function abandonBuildBranch(buildId: string): Promise<void> {
  const identity = await getClientIdentity();
  try {
    await execInSandbox(
      SANDBOX_CONTAINER,
      `cd ${WORKSPACE} && git checkout "${identity.clientBranch}"`,
    );
    console.log(`[build-branch] Abandoned build/${buildId} — back on ${identity.clientBranch}`);
  } catch (err) {
    console.warn(`[build-branch] abandon failed (non-fatal): ${(err as Error).message?.slice(0, 100)}`);
  }
}
