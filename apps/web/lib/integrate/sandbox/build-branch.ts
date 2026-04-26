// apps/web/lib/integrate/sandbox/build-branch.ts
// Git branch management for isolated builds inside the sandbox container.
//
// Branch model (10,000-client hive):
//   client/<clientId>   — persistent per-install branch, never deleted
//       └── build/<buildId>  — per-feature branch, merges into client/<clientId> on promotion
//
// Git author identity (pseudonymous — see identity-privacy.ts):
//   name:  dpf-agent-<shortId>                    (stable pseudonym per install)
//   email: agent-<shortId>@hive.dpf               (matches the pseudonym)
//
// The shortId is derived from clientId so contributions from one install are
// consistently attributed to the same pseudonym across commits, PRs, and
// issues — the community can recognize repeat contributors without the hash
// revealing anything about the real user or organization.

import { execInSandbox, isSandboxRunning } from "./sandbox";
import { prisma } from "@dpf/db";

const SANDBOX_CONTAINER = process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1";
const SANDBOX_PORT = Number(process.env.SANDBOX_PORT ?? "3035");
const WORKSPACE = "/workspace";
const GIT_INDEX_LOCK = `${WORKSPACE}/.git/index.lock`;
const SANDBOX_GIT_STAGE_EXCLUDES = [
  ":!node_modules",
  ":!**/node_modules/**",
  ":!.next",
  ":!**/.next/**",
  ":!.pnpm-store",
  ":!**/.pnpm-store/**",
  ":!*.tsbuildinfo",
  ":!**/*.tsbuildinfo",
  ":!pnpm-lock*",
] as const;
const SANDBOX_GIT_CLEAN_EXCLUDES = [
  ":!node_modules",
  ":!**/node_modules/**",
  ":!.pnpm-store",
  ":!**/.pnpm-store/**",
  ":!pnpm-lock*",
] as const;
const SANDBOX_TRACKED_CACHE_FIND_PATHS = [
  "./.pnpm-store",
  "*/.pnpm-store",
  "./node_modules",
  "*/node_modules",
  "*/.next",
] as const;

function quoteGitPathspec(pathspec: string): string {
  return `'${pathspec}'`;
}

export function buildSandboxGitAddCommand(): string {
  return [
    "git add -A --",
    ...SANDBOX_GIT_STAGE_EXCLUDES.map(quoteGitPathspec),
  ].join(" ");
}

export function buildSandboxBranchSwitchPrepCommand(workspace: string = WORKSPACE): string {
  return [
    `for _dpf_pid in $(ss -tlnp 2>/dev/null | awk '/:3000 / { if (match($NF, /pid=([0-9]+)/, m)) print m[1]; }' | sort -u); do kill "$_dpf_pid" >/dev/null 2>&1 || true; done`,
    `for _dpf_pid in $(ss -tlnp 2>/dev/null | awk '/:3000 / { if (match($NF, /pid=([0-9]+)/, m)) print m[1]; }' | sort -u); do kill -9 "$_dpf_pid" >/dev/null 2>&1 || true; done`,
    `rm -rf ${workspace}/apps/web/.next`,
    `rm -f ${workspace}/apps/web/tsconfig.tsbuildinfo /tmp/next-dev.log /tmp/dev-server.log /tmp/dev.log`,
  ].join(" && ");
}

export function buildSandboxGitCleanCommand(workspace: string = WORKSPACE): string {
  return `cd ${workspace} && git reset --hard HEAD && git clean -fd -- ${SANDBOX_GIT_CLEAN_EXCLUDES.map(quoteGitPathspec).join(" ")}`;
}

export function buildSandboxGitPruneTrackedArtifactsCommand(): string {
  const cacheFindExpr = SANDBOX_TRACKED_CACHE_FIND_PATHS
    .map((pattern) => `-path '${pattern}'`)
    .join(" -o ");
  return [
    `find . \\( ${cacheFindExpr} \\) -prune -print | while IFS= read -r path; do git rm -r --cached --ignore-unmatch -- "$path" >/dev/null 2>&1 || true; done`,
    `find . -name '*.tsbuildinfo' -print | while IFS= read -r path; do git rm --cached --ignore-unmatch -- "$path" >/dev/null 2>&1 || true; done`,
  ].join(" && ");
}

export function buildSandboxGitCommitPrunedArtifactsCommand(
  message: string,
  workspace: string = WORKSPACE,
): string {
  return [
    `cd ${workspace}`,
    buildSandboxGitPruneTrackedArtifactsCommand(),
    `if ! git diff --cached --quiet --exit-code; then git commit -m ${quoteGitPathspec(message)}; fi`,
  ].join(" && ");
}

function sandboxGitPrelude(): string {
  return [
    `if [ -f "${GIT_INDEX_LOCK}" ]; then for _dpf_git_wait in 1 2 3 4 5; do if ! pgrep -x git >/dev/null 2>&1; then break; fi; sleep 1; done; if [ -f "${GIT_INDEX_LOCK}" ] && ! pgrep -x git >/dev/null 2>&1; then rm -f "${GIT_INDEX_LOCK}"; fi; fi`,
    `git config --global --add safe.directory "${WORKSPACE}" >/dev/null 2>&1 || true`,
  ].join(" && ");
}

export function wrapSandboxGitCommand(command: string): string {
  return [
    sandboxGitPrelude(),
    command,
  ].join(" && ");
}

async function execSandboxGit(command: string): Promise<string> {
  return execInSandbox(SANDBOX_CONTAINER, wrapSandboxGitCommand(command));
}

async function normalizeSandboxBranchArtifacts(branchName: string): Promise<void> {
  await execSandboxGit(
    buildSandboxGitCommitPrunedArtifactsCommand(
      `chore: untrack sandbox generated artifacts on ${branchName}`,
    ),
  ).catch((err) => {
    console.warn(`[build-branch] artifact prune commit skipped on ${branchName}: ${(err as Error).message?.slice(0, 200)}`);
  });
}

// ─── Client Identity ─────────────────────────────────────────────────────────

type ClientIdentity = {
  clientId: string;
  gitAgentEmail: string;
  gitAuthorName: string; // "dpf-agent-<shortId>" — matches identity-privacy.getPlatformIdentity()
  clientBranch: string;  // "client/<clientId>"
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

  // Author name matches identity-privacy.getPlatformIdentity() — use the
  // 8-char hash prefix from the seeded gitAgentEmail so commits and PRs
  // carry a consistent pseudonym across code paths.
  const emailLocalPart = config.gitAgentEmail.split("@")[0] ?? "";
  const shortId = emailLocalPart.replace(/^agent-/, "").slice(0, 8);

  _cachedIdentity = {
    clientId: config.clientId,
    gitAgentEmail: config.gitAgentEmail,
    gitAuthorName: `dpf-agent-${shortId}`,
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
  await execSandboxGit(
    [
      `git -C ${WORKSPACE} config user.name "${identity.gitAuthorName}"`,
      `git -C ${WORKSPACE} config user.email "${identity.gitAgentEmail}"`,
    ].join(" && "),
  ).catch(() => {});

  const isRepo = await execSandboxGit(
    `git -C ${WORKSPACE} rev-parse --is-inside-work-tree 2>/dev/null && echo yes || echo no`,
  ).catch(() => "no");

  if (isRepo.trim() !== "yes") {
    await execSandboxGit(
      [
        `cd ${WORKSPACE}`,
        `git init`,
        `git config user.name "${identity.gitAuthorName}"`,
        `git config user.email "${identity.gitAgentEmail}"`,
        buildSandboxGitPruneTrackedArtifactsCommand(),
        buildSandboxGitAddCommand(),
        `git commit -m 'sandbox baseline' --allow-empty`,
      ].join(" && "),
    );
    return;
  }

  // Ensure at least one commit exists
  const commitCount = await execSandboxGit(
    `git -C ${WORKSPACE} rev-list --count HEAD 2>/dev/null || echo 0`,
  ).catch(() => "0");

  if (commitCount.trim() === "0") {
    await execSandboxGit(
      [
        `cd ${WORKSPACE}`,
        `git config user.name "${identity.gitAuthorName}"`,
        `git config user.email "${identity.gitAgentEmail}"`,
        buildSandboxGitPruneTrackedArtifactsCommand(),
        buildSandboxGitAddCommand(),
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
  const exists = await execSandboxGit(
    `git -C ${WORKSPACE} branch --list "${identity.clientBranch}" | grep -q . && echo yes || echo no`,
  ).catch(() => "no");

  if (exists.trim() !== "yes") {
    await execSandboxGit(
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

  // Scrub any uncommitted leakage from a prior build before switching branches.
  //
  // Without this, a previous build's working-tree changes (not yet committed —
  // e.g. because deploy_feature never ran, or the run crashed) bleed into
  // the new build's diff. In the subnet-graph run this caused 34 files of
  // leakage from an earlier HOA build.
  //
  // Preserve the large generated/cached directories so pnpm install stays hot.
  // `git reset --hard HEAD` wipes tracked modifications; `git clean -fd` with
  // exclusions deletes untracked source files without touching node_modules etc.
  await execSandboxGit(
    buildSandboxBranchSwitchPrepCommand(),
  ).catch((err) => {
    console.warn(`[build-branch] preview cleanup failed (non-fatal): ${(err as Error).message?.slice(0, 200)}`);
  });

  await execSandboxGit(
    buildSandboxGitCleanCommand(),
  ).catch((err) => {
    console.warn(`[build-branch] pre-checkout scrub failed (non-fatal): ${(err as Error).message?.slice(0, 200)}`);
  });

  await execSandboxGit(
    `cd ${WORKSPACE} && ${buildSandboxGitPruneTrackedArtifactsCommand()}`,
  ).catch((err) => {
    console.warn(`[build-branch] cache prune failed (non-fatal): ${(err as Error).message?.slice(0, 200)}`);
  });

  // Switch to client branch before forking the build branch
  await execSandboxGit(
    `git -C ${WORKSPACE} checkout "${identity.clientBranch}"`,
  );
  await normalizeSandboxBranchArtifacts(identity.clientBranch);

  const branchName = `build/${buildId}`;

  const branchExists = await execSandboxGit(
    `git -C ${WORKSPACE} branch --list "${branchName}" | grep -q . && echo yes || echo no`,
  ).catch(() => "no");

  if (branchExists.trim() === "yes") {
    await execSandboxGit(
      `git -C ${WORKSPACE} checkout "${branchName}"`,
    );
    await normalizeSandboxBranchArtifacts(branchName);
    console.log(`[build-branch] Resumed build branch: ${branchName}`);
  } else {
    await execSandboxGit(
      `git -C ${WORKSPACE} checkout -b "${branchName}"`,
    );
    await normalizeSandboxBranchArtifacts(branchName);
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
    const out = await execSandboxGit(
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

  await execSandboxGit(
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
    await execSandboxGit(
      `cd ${WORKSPACE} && git checkout "${identity.clientBranch}"`,
    );
    console.log(`[build-branch] Abandoned build/${buildId} — back on ${identity.clientBranch}`);
  } catch (err) {
    console.warn(`[build-branch] abandon failed (non-fatal): ${(err as Error).message?.slice(0, 100)}`);
  }
}
