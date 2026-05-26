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

async function defaultExecFile(cmd: string, args: string[]): Promise<{ stdout: string }> {
  const { execFile: nodeExecFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execAsync = promisify(nodeExecFile);
  const result = await execAsync(cmd, args);
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
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export function isShaFresh(deployedSha: string | null, targetSha: string): boolean {
  if (!deployedSha) return false;
  const minLen = Math.min(deployedSha.length, targetSha.length);
  return deployedSha.slice(0, minLen) === targetSha.slice(0, minLen);
}
