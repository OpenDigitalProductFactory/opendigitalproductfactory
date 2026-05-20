import { promisify } from "node:util";
import { execFile as execFileCb } from "node:child_process";

import { readImageVersion } from "@/lib/platform/image-version";

const execFile = promisify(execFileCb);
const GIT_SHA_RE = /^[0-9a-f]{40}$/i;

export type UpgradeVersionReason =
  | "behind-target"
  | "current-not-git-sha"
  | "target-not-git-sha"
  | "up-to-date";

export type UpgradeVersionState = {
  currentSha: string | null;
  targetSha: string | null;
  comparable: boolean;
  upToDate: boolean;
  reason: UpgradeVersionReason;
};

type VersionConfig = {
  hostSourceMountPath: string;
  repositoryRemote: string;
  repositoryBranch: string;
};

type CurrentVersion =
  | { version: string; comparableToGitSha: boolean }
  | { raw: string; source: string }
  | null;

type VersionDeps = {
  readCurrentVersion?: () => Promise<CurrentVersion>;
  execFile?: (file: string, args: string[]) => Promise<{ stdout: string }>;
};

export function compareUpgradeVersions(
  currentSha: string | null,
  targetSha: string | null,
): UpgradeVersionState {
  if (!targetSha || !GIT_SHA_RE.test(targetSha)) {
    return {
      currentSha,
      targetSha,
      comparable: false,
      upToDate: false,
      reason: "target-not-git-sha",
    };
  }

  if (!currentSha || !GIT_SHA_RE.test(currentSha)) {
    return {
      currentSha,
      targetSha,
      comparable: false,
      upToDate: false,
      reason: "current-not-git-sha",
    };
  }

  const upToDate = currentSha.toLowerCase() === targetSha.toLowerCase();
  return {
    currentSha,
    targetSha,
    comparable: true,
    upToDate,
    reason: upToDate ? "up-to-date" : "behind-target",
  };
}

export function buildRemoteHeadCommand(input: {
  hostSourcePath: string;
  remote: string;
  branch: string;
}): string[] {
  return ["git", "-C", input.hostSourcePath, "rev-parse", `${input.remote}/${input.branch}`];
}

function normalizeCurrentVersion(version: CurrentVersion): string | null {
  if (!version) return null;
  if ("version" in version) return version.comparableToGitSha ? version.version : null;
  return version.source === "git-sha" ? version.raw : null;
}

export async function getUpgradeVersionState(
  config: VersionConfig,
  deps: VersionDeps = {},
): Promise<UpgradeVersionState> {
  const readCurrentVersion = deps.readCurrentVersion ?? readImageVersion;
  const exec = deps.execFile ?? execFile;
  const command = buildRemoteHeadCommand({
    hostSourcePath: config.hostSourceMountPath,
    remote: config.repositoryRemote,
    branch: config.repositoryBranch,
  });

  const [file, ...args] = command;
  const [currentVersion, target] = await Promise.all([
    readCurrentVersion(),
    exec(file, args),
  ]);

  return compareUpgradeVersions(normalizeCurrentVersion(currentVersion), target.stdout.trim());
}
