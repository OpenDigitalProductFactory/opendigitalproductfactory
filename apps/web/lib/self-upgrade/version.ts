// ─── Legacy API ──────────────────────────────────────────────────────────────
// Keep backward-compat exports until all callers are updated to the new API.

export type UpgradeVersionState = {
  currentSha: string | null;
  targetSha: string | null;
  comparable: boolean;
  upToDate: boolean;
  reason: string;
};

/** @deprecated Returns a stub state — version registry not yet implemented */
export async function getUpgradeVersionState(_config: unknown, _deps?: unknown): Promise<UpgradeVersionState> {
  return { currentSha: null, targetSha: null, comparable: false, upToDate: false, reason: "no-target" };
}

/** @deprecated */
export function compareUpgradeVersions(currentSha: string | null, targetSha: string | null): UpgradeVersionState {
  if (!targetSha) return { currentSha, targetSha, comparable: false, upToDate: false, reason: "target-not-git-sha" };
  if (!currentSha) return { currentSha, targetSha, comparable: false, upToDate: false, reason: "current-not-git-sha" };
  const upToDate = currentSha.toLowerCase() === targetSha.toLowerCase();
  return { currentSha, targetSha, comparable: true, upToDate, reason: upToDate ? "up-to-date" : "behind-target" };
}

/** @deprecated */
export function buildRemoteHeadCommand(input: { hostSourcePath: string; remote: string; branch: string }): string[] {
  return ["git", "-C", input.hostSourcePath, "rev-parse", `${input.remote}/${input.branch}`];
}

// ─── Current API ─────────────────────────────────────────────────────────────

export async function resolveTargetSha(_channel: string): Promise<string | null> {
  // Channel resolution will be implemented when the version registry is available.
  return null;
}

export function isShaFresh(deployedSha: string | null, targetSha: string): boolean {
  if (!deployedSha) return false;
  const minLen = Math.min(deployedSha.length, targetSha.length);
  return deployedSha.slice(0, minLen) === targetSha.slice(0, minLen);
}
