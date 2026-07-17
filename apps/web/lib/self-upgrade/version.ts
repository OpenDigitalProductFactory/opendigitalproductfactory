import { getErrorMessage } from "@/lib/shared/get-error-message";
// apps/web/lib/self-upgrade/version.ts
// Version state helpers for the self-upgrade subsystem.

const GIT_SHA_RE = /^[0-9a-f]{40}$/i;

function isGitSha(s: string | null | undefined): boolean {
  return !!s && GIT_SHA_RE.test(s);
}

// ─── Shared Types ─────────────────────────────────────────────────────────────

export type UpgradeVersionState = {
  currentSha: string | null;
  targetSha: string | null;
  comparable: boolean;
  upToDate: boolean;
  reason: string;
};

// ─── Pure Comparator ─────────────────────────────────────────────────────────

export function compareUpgradeVersions(
  currentSha: string | null,
  targetSha: string | null,
): UpgradeVersionState {
  if (!isGitSha(targetSha)) {
    return { currentSha, targetSha, comparable: false, upToDate: false, reason: "target-not-git-sha" };
  }
  if (!isGitSha(currentSha)) {
    return { currentSha, targetSha, comparable: false, upToDate: false, reason: "current-not-git-sha" };
  }
  const upToDate = currentSha!.toLowerCase() === targetSha!.toLowerCase();
  return { currentSha, targetSha, comparable: true, upToDate, reason: upToDate ? "up-to-date" : "behind-target" };
}

// ─── Remote HEAD Command Builder ──────────────────────────────────────────────

export function buildRemoteHeadCommand(input: {
  hostSourcePath: string;
  remote: string;
  branch: string;
}): string[] {
  return ["git", "-C", input.hostSourcePath, "rev-parse", `${input.remote}/${input.branch}`];
}

// ─── Source-Preparation Command Builders ──────────────────────────────────────
// Pure argv builders shared by the TS source-prep orchestrator and mirrored by
// scripts/promote.sh, so both sides resolve the upgrade source identically and
// the deployed stamp always describes the bytes that were actually built.
// See the governed-upgrade-lifecycle spec §5.0.

/** `git -C <path> fetch <remote> <branch>` — freshen the ref before resolving. */
export function buildFetchCommand(input: {
  hostSourcePath: string;
  remote: string;
  branch: string;
}): string[] {
  return ["git", "-C", input.hostSourcePath, "fetch", input.remote, input.branch];
}

/** `git -C <path> rev-parse HEAD` — the true identity of the tree on disk. */
export function buildHeadShaCommand(hostSourcePath: string): string[] {
  return ["git", "-C", hostSourcePath, "rev-parse", "HEAD"];
}

/** `git -C <path> status --porcelain` — empty stdout ⇒ clean working tree. */
export function buildDirtyCheckCommand(hostSourcePath: string): string[] {
  return ["git", "-C", hostSourcePath, "status", "--porcelain"];
}

/**
 * `git -C <path> merge --no-edit --no-ff <remote>/<branch>` — merge the upstream
 * target into the currently checked-out install branch. `--no-ff` guarantees a
 * real merge commit whose SHA becomes the honest deployed stamp (so a
 * fast-forward can't make the stamp ambiguous with upstream's own SHA).
 */
export function buildMergeCommand(input: {
  hostSourcePath: string;
  remote: string;
  branch: string;
}): string[] {
  return [
    "git",
    "-C",
    input.hostSourcePath,
    "merge",
    "--no-edit",
    "--no-ff",
    `${input.remote}/${input.branch}`,
  ];
}

/**
 * The deployed identity stamp for the bytes actually built. A dirty tree yields
 * a non-40-hex `<sha>-dirty` token so `compareUpgradeVersions` honestly reports
 * it as not-a-tracked-release rather than colliding with a real commit SHA.
 */
export function deriveDeployedStamp(headSha: string, dirty: boolean): string {
  const trimmed = headSha.trim();
  return dirty ? `${trimmed}-dirty` : trimmed;
}

// ─── Version State Resolution ─────────────────────────────────────────────────

type VersionStateDeps = {
  readCurrentVersion: (opts?: unknown) => Promise<{ version: string; comparableToGitSha: boolean }>;
  execFile: (cmd: string, args: string[]) => Promise<{ stdout: string }>;
};

type TargetResolverConfig = {
  hostSourceMountPath?: string;
  repositoryRemote?: string;
  repositoryBranch?: string;
};

async function defaultReadCurrentVersion(): Promise<{ version: string; comparableToGitSha: boolean }> {
  try {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile("/app/.dpf-image-version", "utf8");
    const version = raw.trim();
    return { version, comparableToGitSha: GIT_SHA_RE.test(version) };
  } catch {
    return { version: "", comparableToGitSha: false };
  }
}

/**
 * Hard ceiling on the version-resolution git calls (rev-parse the remote-tracking
 * head, etc.). These run INSIDE the /ops/self-upgrade render (getSelfUpgradeStatus
 * → getCurrentImpactSummaryId → resolveTargetSha). Without a timeout, a git call
 * that stalls — waiting on the host clone's index/ref lock held by a concurrent
 * self-upgrade prep merge, or slow process-spawn under Windows/WSL2 contention —
 * hangs the whole page render for tens of seconds (observed 2026-07-17: the page
 * "eventually comes up" only when the running upgrade's `git merge` releases).
 * A timed-out call is killed and surfaces as an error, which resolveTargetSha
 * already degrades to `null` (target-unknown) so the page renders promptly. This
 * mirrors defaultGitRunner's timeout in prepare-source.ts (BI-4A400DE4). 8s is
 * far above a healthy local rev-parse yet bounds the render.
 */
const VERSION_GIT_TIMEOUT_MS = 8_000;

async function defaultExecFile(cmd: string, args: string[]): Promise<{ stdout: string }> {
  const { execFile: nodeExecFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execAsync = promisify(nodeExecFile);
  const result = await execAsync(cmd, args, {
    timeout: VERSION_GIT_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  return { stdout: result.stdout.toString() };
}

const DEFAULT_DEPS: VersionStateDeps = {
  readCurrentVersion: defaultReadCurrentVersion,
  execFile: defaultExecFile,
};

export async function getUpgradeVersionState(
  config: {
    hostSourceMountPath?: string;
    repositoryRemote?: string;
    repositoryBranch?: string;
    [key: string]: unknown;
  },
  deps: VersionStateDeps = DEFAULT_DEPS,
): Promise<UpgradeVersionState> {
  const { version, comparableToGitSha } = await deps.readCurrentVersion();
  const currentSha = comparableToGitSha ? version : null;

  const [, ...gitArgs] = buildRemoteHeadCommand({
    hostSourcePath: config.hostSourceMountPath ?? process.env.HOST_SOURCE_PATH ?? "/workspace",
    remote: config.repositoryRemote ?? process.env.REPO_REMOTE ?? "origin",
    branch: config.repositoryBranch ?? process.env.REPO_BRANCH ?? "main",
  });
  const { stdout } = await deps.execFile("git", gitArgs);
  const targetSha = stdout.trim() || null;

  return compareUpgradeVersions(currentSha, targetSha);
}

// ─── Compatibility Exports ────────────────────────────────────────────────────

export async function resolveTargetSha(
  channel: string,
  config: TargetResolverConfig = {},
  deps: Pick<VersionStateDeps, "execFile"> = DEFAULT_DEPS,
): Promise<string | null> {
  const [, ...gitArgs] = buildRemoteHeadCommand({
    hostSourcePath: config.hostSourceMountPath ?? process.env.HOST_SOURCE_PATH ?? "/workspace",
    remote: config.repositoryRemote ?? process.env.REPO_REMOTE ?? "origin",
    branch: config.repositoryBranch ?? process.env.REPO_BRANCH ?? "main",
  });

  try {
    const { stdout } = await deps.execFile("git", gitArgs);
    const targetSha = stdout.trim();
    if (isGitSha(targetSha)) return targetSha;
    console.info("self-upgrade.no-target", {
      channel,
      reason: "target-not-git-sha",
      targetSha,
    });
    return null;
  } catch (err) {
    console.info("self-upgrade.no-target", {
      channel,
      reason: "target-resolution-failed",
      message: getErrorMessage(err),
    });
    return null;
  }
}

export function isShaFresh(deployedSha: string | null, targetSha: string): boolean {
  if (!deployedSha) return false;
  // Both sides must be git-SHA-shaped (40 hex chars) before declaring fresh.
  // A 64-char content-hash image identity is not comparable to a git SHA;
  // returning false here preserves the spec invariant that "isFresh => the
  // running runtime is at the target commit" rather than a coincidental
  // hex-prefix collision.
  if (!isGitSha(deployedSha) || !isGitSha(targetSha)) return false;
  return deployedSha.toLowerCase() === targetSha.toLowerCase();
}
