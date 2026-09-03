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

// ─── Remote Target Resolution (BI-4746F2A9) ───────────────────────────────────
// The status page and the impact summary used to read `rev-parse origin/main`,
// a LOCAL remote-tracking ref that only moves when something fetches — the
// upgrade run itself or the 24h-throttled scheduled poll. A source-mode install
// therefore said "up to date" (and hid "Upgrade now") for a day after a fix was
// published. "Up to date" must be a statement about upstream, so the target is
// asked of the remote (`git ls-remote`), which touches no local ref and holds no
// lock, bounded by a short cache. When the local ref is behind the remote, one
// single-ref fetch freshens it so the change-set `git log` has the objects. If
// the remote is unreachable the local ref is the honest fallback and the reason
// is logged. The RUN path (queue/functions/self-upgrade.ts) already fetches
// before it resolves and is unchanged.

/** `git -C <path> ls-remote --heads <remote> <branch>` — ask upstream, not the local ref. */
export function buildRemoteLsCommand(input: {
  hostSourcePath: string;
  remote: string;
  branch: string;
}): string[] {
  return ["git", "-C", input.hostSourcePath, "ls-remote", "--heads", input.remote, input.branch];
}

/** The SHA on the `refs/heads/<branch>` line of `ls-remote --heads` output, or null. */
export function parseRemoteHeadSha(stdout: string, branch: string): string | null {
  const wanted = `refs/heads/${branch}`;
  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const tab = line.indexOf("\t");
    const sha = tab === -1 ? line : line.slice(0, tab);
    const ref = tab === -1 ? "" : line.slice(tab + 1).trim();
    if (ref === wanted && isGitSha(sha)) return sha.toLowerCase();
  }
  return null;
}

/** How long one remote answer stands in for every status render (~1 min). */
export const TARGET_SHA_CACHE_TTL_MS = 60_000;

export type TargetShaSource = "remote" | "local-ref";

type TargetShaCacheEntry = {
  sha: string | null;
  source: TargetShaSource | null;
  resolvedAt: number;
};

const targetShaCache = new Map<string, TargetShaCacheEntry>();
const targetShaInFlight = new Map<string, Promise<TargetShaCacheEntry>>();

/** Test seam: forget every cached remote answer. */
export function resetTargetShaCacheForTests(): void {
  targetShaCache.clear();
  targetShaInFlight.clear();
}

async function readLocalRef(
  at: { hostSourcePath: string; remote: string; branch: string },
  execFile: VersionStateDeps["execFile"],
): Promise<string | null> {
  const [, ...gitArgs] = buildRemoteHeadCommand(at);
  const { stdout } = await execFile("git", gitArgs);
  const sha = stdout.trim();
  return isGitSha(sha) ? sha.toLowerCase() : null;
}

async function resolveTargetShaUncached(
  channel: string,
  at: { hostSourcePath: string; remote: string; branch: string },
  execFile: VersionStateDeps["execFile"],
): Promise<TargetShaCacheEntry> {
  const resolvedAt = Date.now();
  let remoteFailure: string | null = null;
  try {
    const [, ...lsArgs] = buildRemoteLsCommand(at);
    const { stdout } = await execFile("git", lsArgs);
    const remoteSha = parseRemoteHeadSha(stdout, at.branch);
    if (remoteSha) {
      // Freshen the local ref only when it is actually behind, so the impact
      // summary's `git log <lineage>..<target>` can see the target's objects.
      // Best effort: a failed fetch does not change the answer.
      let localSha: string | null = null;
      try {
        localSha = await readLocalRef(at, execFile);
      } catch {
        localSha = null;
      }
      if (localSha !== remoteSha) {
        try {
          const [, ...fetchArgs] = buildFetchCommand(at);
          await execFile("git", fetchArgs);
        } catch (err) {
          console.info("self-upgrade.target-fetch-skipped", {
            channel,
            message: getErrorMessage(err),
          });
        }
      }
      return { sha: remoteSha, source: "remote", resolvedAt };
    }
    remoteFailure = "remote-head-not-listed";
  } catch (err) {
    remoteFailure = getErrorMessage(err);
  }

  // The remote could not answer: the local ref is the honest fallback, and the
  // reason it is being used is said, not swallowed.
  try {
    const localSha = await readLocalRef(at, execFile);
    if (localSha) {
      console.info("self-upgrade.target-from-local-ref", {
        channel,
        reason: "remote-unreachable",
        message: remoteFailure,
      });
      return { sha: localSha, source: "local-ref", resolvedAt };
    }
    console.info("self-upgrade.no-target", {
      channel,
      reason: "target-not-git-sha",
      message: remoteFailure,
    });
    return { sha: null, source: null, resolvedAt };
  } catch (err) {
    console.info("self-upgrade.no-target", {
      channel,
      reason: "target-resolution-failed",
      message: `${remoteFailure}; ${getErrorMessage(err)}`,
    });
    return { sha: null, source: null, resolvedAt };
  }
}

/**
 * Resolve the upgrade target for STATUS surfaces (the page, the impact
 * summary): the remote branch head, cached for TARGET_SHA_CACHE_TTL_MS and
 * shared by concurrent renders. Returns null when neither the remote nor the
 * local ref yields a git SHA.
 */
export async function resolveTargetSha(
  channel: string,
  config: TargetResolverConfig = {},
  deps: Pick<VersionStateDeps, "execFile"> = DEFAULT_DEPS,
  options: { now?: () => number } = {},
): Promise<string | null> {
  const at = {
    hostSourcePath: config.hostSourceMountPath ?? process.env.HOST_SOURCE_PATH ?? "/workspace",
    remote: config.repositoryRemote ?? process.env.REPO_REMOTE ?? "origin",
    branch: config.repositoryBranch ?? process.env.REPO_BRANCH ?? "main",
  };
  const key = `${at.hostSourcePath} ${at.remote} ${at.branch}`;
  const now = options.now?.() ?? Date.now();
  const cached = targetShaCache.get(key);
  if (cached && cached.sha && now - cached.resolvedAt < TARGET_SHA_CACHE_TTL_MS) {
    return cached.sha;
  }
  let pending = targetShaInFlight.get(key);
  if (!pending) {
    pending = resolveTargetShaUncached(channel, at, deps.execFile)
      .then((entry) => {
        // A miss is not cached: the next render asks again rather than hiding
        // "Upgrade now" for a minute because one call happened to time out.
        if (entry.sha) targetShaCache.set(key, { ...entry, resolvedAt: now });
        return entry;
      })
      .finally(() => {
        targetShaInFlight.delete(key);
      });
    targetShaInFlight.set(key, pending);
  }
  return (await pending).sha;
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
