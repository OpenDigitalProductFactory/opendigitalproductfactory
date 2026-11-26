// Upgrade-source identity helpers shared by the portal (version.ts) and the
// authorized source writer in the promoter image (BI-224F56F1).

/** `git -C <path> rev-parse HEAD` — the true identity of the tree on disk. */
export function buildHeadShaCommand(hostSourcePath) {
  return ["git", "-C", hostSourcePath, "rev-parse", "HEAD"];
}

/** `git -C <path> status --porcelain` — empty stdout ⇒ clean working tree. */
export function buildDirtyCheckCommand(hostSourcePath) {
  return ["git", "-C", hostSourcePath, "status", "--porcelain"];
}

/**
 * The deployed identity stamp for the bytes actually built. A dirty tree yields
 * a non-40-hex `<sha>-dirty` token so `compareUpgradeVersions` honestly reports
 * it as not-a-tracked-release rather than colliding with a real commit SHA.
 */
export function deriveDeployedStamp(headSha, dirty) {
  const trimmed = headSha.trim();
  return dirty ? `${trimmed}-dirty` : trimmed;
}
