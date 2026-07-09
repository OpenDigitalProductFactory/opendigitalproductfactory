// Shared durable-artifact roots for process-spine guards (BI-38578194).
// Keep in one module so SessionEnd, Stop, and git post-checkout agree on scope.

/** Repo-relative path prefixes whose loss on branch switch is unacceptable. */
export const DURABLE_ARTIFACT_PREFIXES = [
  "docs/superpowers/specs/",
  "docs/superpowers/plans/",
];

/**
 * @param {string} relPath
 * @returns {boolean}
 */
export function isDurableArtifactPath(relPath) {
  const norm = String(relPath ?? "").replace(/\\/g, "/");
  return DURABLE_ARTIFACT_PREFIXES.some((prefix) => norm.startsWith(prefix));
}