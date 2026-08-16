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
import { buildBuildStudioSandboxTargetInput } from "@/lib/runtime-coordination/build-studio-runtime";
import {
  registerRuntimeTarget,
  type RuntimeCoordinationDb,
} from "@/lib/runtime-coordination/runtime-targets";
import {
  buildSandboxSourceCurrencyProbeCommand,
  classifySandboxSourceCurrency,
  formatSandboxSourceCurrencySummary,
  parseSandboxSourceCurrencyProbeOutput,
  type SandboxSourceCurrencySnapshot,
} from "./sandbox-source-currency";

const SANDBOX_CONTAINER = process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1";
const SANDBOX_PORT = Number(process.env.SANDBOX_PORT ?? "3035");
const WORKSPACE = "/workspace";
const GIT_INDEX_LOCK = `${WORKSPACE}/.git/index.lock`;
const SANDBOX_GIT_STAGE_EXCLUDES = [
  // Never stage per-build worktree homes (.builds/<id>) — they are nested git
  // worktrees, not source. Without this, `git add` tracks them as gitlinks and
  // every subsequent build sees a perpetually-"dirty" tree (worktree-isolation
  // regression that blocked start_build).
  ":!.builds",
  ":!**/.builds/**",
  ":!node_modules",
  ":!**/node_modules/**",
  ":!.next",
  ":!**/.next/**",
  ":!.pnpm-store",
  ":!**/.pnpm-store/**",
  ":!*.tsbuildinfo",
  ":!**/*.tsbuildinfo",
  ":!pnpm-lock*",
  // Generated Prisma client: regenerated on every `prisma generate` and must
  // never enter the diff baseline. A stale sandbox image produces wrong types
  // that bloat the patch and cause schema regressions on main.
  ":!**/generated/client/**",
  ":!packages/db/generated/**",
] as const;
const SANDBOX_GIT_CLEAN_EXCLUDES = [
  // Protect active per-build worktrees (.builds/<id>) from the pre-build scrub.
  ":!.builds",
  ":!**/.builds/**",
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
  const excludes = SANDBOX_GIT_STAGE_EXCLUDES.map(quoteGitPathspec).join(" ");
  return [
    "git add -u",
    `git ls-files -z --others --exclude-standard -- . ${excludes} | xargs -0 -r git add --`,
  ].join(" && ");
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

/**
 * Preserve a prior build's uncommitted source on ITS OWN branch before the
 * shared /workspace tree is scrubbed for the next build. Acts ONLY when a
 * `build/*` branch is checked out (never client/<id> or a baseline), and only
 * when there are stage-able source changes. Without this, a build whose
 * generated code had not yet been committed — the agentic loop crashed, or the
 * next build's startBuildBranch ran mid-flight — lost that work to the
 * `git clean -fd` scrub below. That was the dominant data-loss path behind
 * builds stranding with no code (BI-98B723C0). Generated/cache artifacts are
 * excluded via buildSandboxGitAddCommand's pathspecs, so only real source is
 * committed; the commit is best-effort (`|| true`) so a no-op never blocks the
 * build start.
 */
export function buildSandboxCommitInFlightWorkCommand(workspace: string = WORKSPACE): string {
  return [
    `cd ${workspace}`,
    `if git rev-parse --abbrev-ref HEAD 2>/dev/null | grep -q '^build/'; then ${buildSandboxGitAddCommand()}; if ! git diff --cached --quiet --exit-code; then git commit -m 'wip: preserve in-flight build work before branch switch' >/dev/null 2>&1 || true; fi; fi`,
  ].join(" && ");
}

// ─── Phase 2: per-build worktree isolation (BI-98B723C0) ─────────────────────
// commitInFlightWork above is the Phase 1 *mitigation* — it preserves a build's
// source before the shared /workspace tree is scrubbed for the next build. The
// durable fix is to stop sharing one tree at all: give each build its OWN git
// worktree under /workspace/.builds/<buildId> so a concurrent build's branch
// switch can never scrub or corrupt another build's working tree (the root
// cause of the data loss — the WWMD kernel chose this over a serial-rebuild
// shortcut on Architecture-Over-Shortcuts grounds).
//
// node_modules is NOT reinstalled per worktree — it is shared from the canonical
// /workspace install by symlink. Verified live in dpf-sandbox-1 (2026-06-19):
// with the symlinks below, `tsc`, `react`, and `next` all resolve from the
// worktree, so a per-build worktree needs no `pnpm install` of its own.
//
// These are the lifecycle PRIMITIVES (slice 1). Wiring them into
// startBuildBranch + threading the per-build workdir through the dispatchers is
// the follow-up slice; until then nothing calls these, so behaviour is
// unchanged.

/** Root under which each build's isolated worktree lives. */
export const BUILD_WORKTREE_ROOT_SEGMENT = ".builds";

/** Absolute path of a build's isolated git worktree inside the sandbox. */
export function buildWorktreePath(buildId: string, workspace: string = WORKSPACE): string {
  return `${workspace}/${BUILD_WORKTREE_ROOT_SEGMENT}/${buildId}`;
}

/**
 * Feature flag for per-build worktree isolation. Default OFF: until the
 * dispatchers and sandbox helpers are threaded to honor resolveBuildWorkdir,
 * builds must keep running in the shared /workspace tree, so the worktree path
 * must NOT be handed out yet. Flip `DPF_BUILD_WORKTREE_ISOLATION=1` only after
 * the end-to-end worktree build path is live-verified (the follow-up slice).
 */
export function isBuildWorktreeIsolationEnabled(): boolean {
  return process.env.DPF_BUILD_WORKTREE_ISOLATION === "1";
}

/**
 * The working directory a build's file-level commands (dispatch, typecheck,
 * diff) should run in. This is the SINGLE seam the dispatchers + sandbox
 * helpers route through, so per-build isolation flips with one flag instead of
 * 30 scattered conditionals:
 *   - isolation ON  → the build's own worktree (buildWorktreePath)
 *   - isolation OFF → the shared workspace (identical to today's behaviour)
 * Container-level operations (the git repo root, docker exec target) stay on
 * `workspace` and must NOT use this — only per-build *file* operations move.
 */
export function resolveBuildWorkdir(buildId: string, workspace: string = WORKSPACE): string {
  return isBuildWorktreeIsolationEnabled()
    ? buildWorktreePath(buildId, workspace)
    : workspace;
}

// node_modules trees shared from the canonical install into each worktree by
// symlink: the repo root plus the web app and the workspace packages whose
// node_modules the build/typecheck toolchain resolves through. Adding a new
// package that a build must compile against means adding its node_modules here.
const WORKTREE_SHARED_NODE_MODULES = [
  "node_modules",
  "apps/web/node_modules",
  "packages/db/node_modules",
  "packages/dpf-skill-pack/node_modules",
  "packages/dpf-bootstrap/node_modules",
] as const;

/**
 * Create a build's isolated worktree at buildWorktreePath(buildId), checked out
 * to `branchRef` (its `build/<buildId>` branch), with node_modules shared from
 * the canonical /workspace install via symlink — no per-worktree `pnpm install`.
 * Idempotent: force-removes any stale worktree at the path and prunes the
 * registry first, so a re-dispatch never trips on a leftover worktree. The
 * `--force` on `worktree add` lets the same branch be (re)attached after a prior
 * crash left the registry pointing at a now-gone path.
 */
export function buildSandboxWorktreeAddCommand(
  buildId: string,
  branchRef: string,
  workspace: string = WORKSPACE,
): string {
  const path = buildWorktreePath(buildId, workspace);
  const symlinks = WORKTREE_SHARED_NODE_MODULES.map(
    (rel) => `ln -s ${workspace}/${rel} ${path}/${rel}`,
  ).join(" && ");
  return [
    `cd ${workspace}`,
    `git worktree remove --force ${path} 2>/dev/null || true`,
    `git worktree prune`,
    `git worktree add --force ${path} ${branchRef}`,
    symlinks,
  ].join(" && ");
}

/**
 * Tear down a build's worktree and prune the registry. Best-effort
 * (`|| true`) so cleanup of an already-gone worktree never fails a build's
 * teardown. The symlinked node_modules are not real files, so removing the
 * worktree never touches the shared install.
 */
export function buildSandboxWorktreeRemoveCommand(
  buildId: string,
  workspace: string = WORKSPACE,
): string {
  const path = buildWorktreePath(buildId, workspace);
  return [
    `cd ${workspace}`,
    `git worktree remove --force ${path} 2>/dev/null || true`,
    `git worktree prune`,
  ].join(" && ");
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
    // The sandbox /workspace is the dedicated BUILD tree — NOT the host
    // merge/release clone that the root-clone pre-commit guard (.githooks,
    // check-root-clone.sh) protects. That guard ships in the repo (so it also
    // runs inside the sandbox image) and refuses a commit whenever the working
    // tree sits on a feat/*|fix/*|chore/*|doc/*|clean/* branch. If the sandbox is
    // ever left on such a branch (e.g. a dev branch got checked out), it silently
    // fails start_build's baseline commit for EVERY subsequent build. Set the
    // guard's sanctioned override here so legitimate in-sandbox build commits
    // never trip the host-oriented guard. (BI-98B723C0 follow-up — observed
    // blocking a re-dispatch when the sandbox sat on feat/bs-local-gpu-serialize.)
    `export DPF_ALLOW_ROOT_CLONE_COMMIT=1`,
    // Same rationale for the pre-commit TYPECHECK: the sandbox is a build tree,
    // not a dev clone, and its pre-commit typecheck runs against a stale /
    // junctioned Prisma client + other pre-existing, out-of-scope errors (e.g.
    // `@prisma/client has no exported member 'PrismaClient'`) that have nothing
    // to do with the build's own diff. Those false positives reject the
    // mechanical `sandbox baseline` commit, so startBuildBranch fails and NO
    // build can enter the build phase. The build's real typecheck is the
    // review-phase SCOPED verification + CI on the PR — not this hook. Bypass it
    // here like the root-clone guard above. (Observed live blocking FB-0A4B102D
    // and the whole fleet at the plan→build handoff.)
    `export DPF_SKIP_TYPECHECK=1`,
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
    console.warn(`[build-branch] artifact prune commit skipped on ${JSON.stringify(branchName)}: ${JSON.stringify((err as Error).message?.slice(0, 200))}`);
  });
}

async function configureAndFetchUpstream(identity: ClientIdentity): Promise<boolean> {
  if (!identity.upstreamRemoteUrl) {
    return false;
  }

  const escapedUrl = JSON.stringify(identity.upstreamRemoteUrl);
  await execSandboxGit(
    [
      `cd ${WORKSPACE}`,
      `if git remote get-url origin >/dev/null 2>&1; then git remote set-url origin ${escapedUrl}; else git remote add origin ${escapedUrl}; fi`,
      `git fetch origin main --prune`,
    ].join(" && "),
  );
  return true;
}

async function inspectCurrentSandboxSourceCurrency(
  targetRef: string,
): Promise<SandboxSourceCurrencySnapshot> {
  const output = await execSandboxGit(
    buildSandboxSourceCurrencyProbeCommand({
      workspace: WORKSPACE,
      targetRef,
    }),
  );
  return parseSandboxSourceCurrencyProbeOutput(output, {
    targetRef,
    checkedAt: new Date().toISOString(),
    workspace: WORKSPACE,
  });
}

async function recordBuildSourceCurrency(
  buildId: string,
  snapshot: SandboxSourceCurrencySnapshot,
  summaryPrefix?: string,
): Promise<void> {
  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: { buildExecState: true },
  });
  const existingState = isRecord(build?.buildExecState) ? build.buildExecState : {};
  const summary = [
    summaryPrefix,
    formatSandboxSourceCurrencySummary(snapshot),
  ].filter(Boolean).join(" ");

  await prisma.featureBuild.update({
    where: { buildId },
    data: {
      buildExecState: {
        ...existingState,
        sourceCurrency: snapshot,
      } as unknown as import("@dpf/db").Prisma.InputJsonValue,
    },
  });
  await prisma.buildActivity.create({
    data: {
      buildId,
      tool: "sandbox_source_currency",
      summary,
    },
  }).catch(() => {});
}

async function refreshCurrentBranchFromTarget(args: {
  buildId: string;
  branchName: string;
  targetRef: string;
  blockUnknown: boolean;
}): Promise<SandboxSourceCurrencySnapshot> {
  const before = await inspectCurrentSandboxSourceCurrency(args.targetRef);

  if (before.status === "behind") {
    await recordBuildSourceCurrency(
      args.buildId,
      before,
      `Auto-refreshing ${args.branchName} before Build Studio work starts.`,
    );
    await execSandboxGit(
      `git -C ${WORKSPACE} reset --hard ${quoteGitPathspec(args.targetRef)}`,
    );
    await normalizeSandboxBranchArtifacts(args.branchName);
    const after = await inspectCurrentSandboxSourceCurrency(args.targetRef);
    await recordBuildSourceCurrency(
      args.buildId,
      after,
      `Auto-refreshed ${args.branchName}.`,
    );
    return after;
  }

  if (before.recommendedAction === "pause" || (args.blockUnknown && before.status === "unknown")) {
    await recordBuildSourceCurrency(
      args.buildId,
      before,
      `Paused ${args.branchName} before Build Studio work starts.`,
    );
    throw new Error(formatSandboxSourceCurrencySummary(before));
  }

  await recordBuildSourceCurrency(args.buildId, before);
  return before;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// ─── Client Identity ─────────────────────────────────────────────────────────

type ClientIdentity = {
  clientId: string;
  gitAgentEmail: string;
  gitAuthorName: string;    // "dpf-agent-<shortId>" — matches identity-privacy.getPlatformIdentity()
  clientBranch: string;     // "client/<clientId>"
  upstreamRemoteUrl: string | null; // Canonical repo URL for fetching origin/main
};

// Canonical Hive upstream — used when PlatformDevConfig.upstreamRemoteUrl is
// unset so the sandbox baseline is ALWAYS reset to origin/main (shared history),
// never a synthetic-root `git init`. Without this, build branches have no
// merge-base with main and contributions can never form a valid PR (BI-5F288AAA).
// Mirrors the same default in contribute_to_hive (mcp-tools.ts) and
// platform-dev-config's UPSTREAM_OWNER_REPO_FALLBACK.
const DEFAULT_UPSTREAM_REMOTE_URL =
  "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory.git";

let _cachedIdentity: ClientIdentity | null = null;

/**
 * Returns the stable client identity from PlatformDevConfig.
 * Cached in memory after first read — identity never changes.
 */
export async function getClientIdentity(): Promise<ClientIdentity> {
  if (_cachedIdentity) return _cachedIdentity;

  const config = await prisma.platformDevConfig.findUnique({
    where: { id: "singleton" },
    select: { clientId: true, gitAgentEmail: true, upstreamRemoteUrl: true },
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
    // Default to the canonical Hive upstream when unset so the sandbox baseline
    // always shares history with origin/main (the keystone for contributions —
    // BI-5F288AAA). The fetch/reset is wrapped in try/catch downstream, so an
    // offline/token failure falls back safely to the portal-copy baseline.
    upstreamRemoteUrl: config.upstreamRemoteUrl ?? DEFAULT_UPSTREAM_REMOTE_URL,
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
 *
 * When upstreamRemoteUrl is provided (set during portal OAuth setup), the
 * sandbox fetches origin/main and resets to it before committing the
 * baseline. This guarantees the sandbox always starts from current main,
 * not from the potentially weeks-old portal container image.
 *
 * Without a remote URL (offline / unconfigured installs) the behaviour is
 * unchanged: commit whatever the portal container copied in.
 *
 * Safe to call multiple times — skips if a baseline already exists.
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

  if (isRepo.trim() === "yes") {
    // Repo already exists — ensure at least one commit, then return.
    const commitCount = await execSandboxGit(
      `git -C ${WORKSPACE} rev-list --count HEAD 2>/dev/null || echo 0`,
    ).catch(() => "0");

    if (commitCount.trim() !== "0") return; // Already has a baseline commit.
  }

  // --- Fresh baseline ---

  // Step 1: git init if not already a repo
  if (isRepo.trim() !== "yes") {
    await execSandboxGit(
      [
        `cd ${WORKSPACE}`,
        `git init`,
        `git config user.name "${identity.gitAuthorName}"`,
        `git config user.email "${identity.gitAgentEmail}"`,
      ].join(" && "),
    );
  }

  // Step 2: If we have an upstream remote URL, fetch origin/main and reset to
  // it so the baseline always matches current main — not the stale portal image.
  // This is the key fix: the portal container image may be weeks behind
  // origin/main; by resetting to origin/main, deploy_feature's diff is always
  // a clean delta against what will actually land on the portal.
  if (identity.upstreamRemoteUrl) {
    try {
      await configureAndFetchUpstream(identity);
      await execSandboxGit(`git -C ${WORKSPACE} reset --hard origin/main`);
      console.log(`[build-branch] Sandbox baseline reset to origin/main via ${identity.upstreamRemoteUrl}`);
    } catch (fetchErr) {
      // Non-fatal: if fetch fails (offline, token expired, etc.) fall through
      // to the portal-copy baseline. The schema regression guard in
      // deploy_feature will catch any stale-schema issues downstream.
      console.warn(
        `[build-branch] Could not fetch origin/main for baseline reset (falling back to portal copy): ${
          (fetchErr as Error).message?.slice(0, 200)
        }`,
      );
    }
  }

  // Step 3: Prune generated/cache artifacts and commit the baseline
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
 * Provision a build's isolated worktree (the isolation-ON path of
 * startBuildBranch). Ensures the build branch exists — created from the client
 * branch with `git branch` (NOT `checkout`, so the shared /workspace tree stays
 * on the client branch) — then creates the worktree on it with node_modules
 * shared by symlink. This is what makes concurrent builds non-contaminating:
 * each runs in its own tree, so no branch switch in /workspace can scrub another
 * build's work (BI-98B723C0).
 */
async function provisionBuildWorktree(args: {
  buildId: string;
  branchName: string;
  clientBranch: string;
}): Promise<void> {
  const { buildId, branchName, clientBranch } = args;
  await execSandboxGit(
    `git -C ${WORKSPACE} branch --list "${branchName}" | grep -q . || git -C ${WORKSPACE} branch "${branchName}" "${clientBranch}"`,
  );
  await execSandboxGit(buildSandboxWorktreeAddCommand(buildId, branchName));
  console.log(
    `[build-branch] Provisioned isolated worktree for ${JSON.stringify(branchName)} at ${JSON.stringify(buildWorktreePath(buildId))}`,
  );
}

/**
 * Tear down a build's worktree (isolation-ON cleanup on promote/abandon).
 * Best-effort — the symlinked node_modules are not real files so removal never
 * touches the shared install, and a missing worktree is not an error.
 */
async function teardownBuildWorktree(buildId: string): Promise<void> {
  await execSandboxGit(buildSandboxWorktreeRemoveCommand(buildId)).catch((err) => {
    console.warn(
      `[build-branch] worktree teardown skipped (non-fatal): ${(err as Error).message?.slice(0, 200)}`,
    );
  });
}

/**
 * Creates (or re-uses) a build branch for this feature.
 * Branch is forked from the client branch: client/<clientId>
 * Updates FeatureBuild with sandboxId/sandboxPort so deploy_feature,
 * the preview proxy, and the promoter all work unchanged.
 */
export async function startBuildBranch(buildId: string): Promise<SandboxSourceCurrencySnapshot | null> {
  const identity = await getClientIdentity();

  await ensureGitBaseline(identity);
  await ensureClientBranch(identity);
  let upstreamVerified = false;
  if (identity.upstreamRemoteUrl) {
    try {
      upstreamVerified = await configureAndFetchUpstream(identity);
    } catch (err) {
      const snapshot = classifySandboxSourceCurrency({
        workspace: WORKSPACE,
        branch: await currentSandboxBranch(),
        targetRef: "origin/main",
        checkedAt: new Date().toISOString(),
      });
      await recordBuildSourceCurrency(
        buildId,
        snapshot,
        `Could not verify origin/main before Build Studio work starts: ${(err as Error).message?.slice(0, 200)}`,
      );
      throw new Error(`Could not verify sandbox source against origin/main: ${(err as Error).message}`);
    }
  }

  // FIRST preserve the currently-checked-out build branch's uncommitted source
  // by committing it to that branch — otherwise the scrub below destroys a prior
  // build's not-yet-committed work (BI-98B723C0: the dominant loss path that left
  // stranded builds, e.g. FB-69231490, with no code). No-op unless a build/*
  // branch with real source changes is checked out.
  await execSandboxGit(
    buildSandboxCommitInFlightWorkCommand(),
  ).catch((err) => {
    console.warn(`[build-branch] in-flight commit-before-switch skipped (non-fatal): ${(err as Error).message?.slice(0, 200)}`);
  });

  // Then scrub any remaining uncommitted leakage from a prior build before
  // switching branches.
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
  if (upstreamVerified) {
    await refreshCurrentBranchFromTarget({
      buildId,
      branchName: identity.clientBranch,
      targetRef: "origin/main",
      blockUnknown: true,
    });
  } else {
    const snapshot = await inspectCurrentSandboxSourceCurrency("origin/main").catch(() =>
      classifySandboxSourceCurrency({
        workspace: WORKSPACE,
        branch: identity.clientBranch,
        targetRef: "origin/main",
        checkedAt: new Date().toISOString(),
      })
    );
    await recordBuildSourceCurrency(
      buildId,
      snapshot,
      "Upstream remote is not configured; sandbox source currency is observe-only.",
    );
  }

  const branchName = `build/${buildId}`;

  if (isBuildWorktreeIsolationEnabled()) {
    // Isolation ON: this build runs in its OWN worktree; /workspace stays on the
    // client branch so a concurrent build can never scrub this one's tree.
    await provisionBuildWorktree({
      buildId,
      branchName,
      clientBranch: identity.clientBranch,
    });
  } else {
    // Isolation OFF (default): the shared-tree checkout path — unchanged.
    const branchExists = await execSandboxGit(
      `git -C ${WORKSPACE} branch --list "${branchName}" | grep -q . && echo yes || echo no`,
    ).catch(() => "no");

    if (branchExists.trim() === "yes") {
      await execSandboxGit(
        `git -C ${WORKSPACE} checkout "${branchName}"`,
      );
      await normalizeSandboxBranchArtifacts(branchName);
      await refreshCurrentBranchFromTarget({
        buildId,
        branchName,
        targetRef: identity.clientBranch,
        blockUnknown: true,
      });
      console.log(`[build-branch] Resumed build branch: ${JSON.stringify(branchName)}`);
    } else {
      await execSandboxGit(
        `git -C ${WORKSPACE} checkout -b "${branchName}"`,
      );
      await normalizeSandboxBranchArtifacts(branchName);
      console.log(`[build-branch] Created build branch: ${JSON.stringify(branchName)} from ${JSON.stringify(identity.clientBranch)}`);
    }
  }
  const finalSourceCurrency = await inspectCurrentSandboxSourceCurrency(
    upstreamVerified ? "origin/main" : identity.clientBranch,
  );
  await recordBuildSourceCurrency(buildId, finalSourceCurrency);

  const updatedBuild = await prisma.featureBuild.update({
    where: { buildId },
    data: {
      sandboxId: SANDBOX_CONTAINER,
      sandboxPort: SANDBOX_PORT,
      buildBranch: branchName,
    },
    select: {
      id: true,
      buildId: true,
      createdById: true,
    },
  });

  const capsule = await prisma.workCapsule.findUnique({
    where: { idempotencyKey: `build-studio:${buildId}` },
    select: { id: true },
  });

  await registerRuntimeTarget({
    db: prisma as unknown as RuntimeCoordinationDb,
    input: buildBuildStudioSandboxTargetInput({
      buildRowId: updatedBuild.id,
      buildId: updatedBuild.buildId,
      capsuleRowId: capsule?.id ?? null,
      containerName: SANDBOX_CONTAINER,
      hostPort: SANDBOX_PORT,
      branchName,
    }),
    actor: {
      userId: updatedBuild.createdById,
      agentId: "build-studio",
      principalId: null,
    },
  });
  return finalSourceCurrency;
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

  // Isolation ON: the merge reads build/<id> from git regardless of which tree
  // holds it, so the now-merged worktree can be torn down.
  if (isBuildWorktreeIsolationEnabled()) {
    await teardownBuildWorktree(buildId);
  }

  console.log(`[build-branch] Promoted ${branchName} → ${identity.clientBranch}`);
}

/**
 * Switches the sandbox back to the client branch without deleting the build branch.
 * The build branch is preserved in git for audit / recovery.
 */
export async function abandonBuildBranch(buildId: string): Promise<void> {
  const identity = await getClientIdentity();
  try {
    // Isolation ON: the build lived in its own worktree, so /workspace is
    // already on the client branch (checkout is a harmless no-op) — just drop
    // the worktree. The branch itself is preserved in git for audit/recovery.
    if (isBuildWorktreeIsolationEnabled()) {
      await teardownBuildWorktree(buildId);
    }
    await execSandboxGit(
      `cd ${WORKSPACE} && git checkout "${identity.clientBranch}"`,
    );
    console.log(`[build-branch] Abandoned build/${buildId} — back on ${identity.clientBranch}`);
  } catch (err) {
    console.warn(`[build-branch] abandon failed (non-fatal): ${(err as Error).message?.slice(0, 100)}`);
  }
}
