// apps/web/lib/build/sandbox-driver.ts
//
// Pure helper that decides which in-flight build is currently "driving"
// the shared sandbox.
//
// Per the design spec §1 (footer) and §6 (OpenSandboxButton):
//   - All builds share one sandbox (project_self_upgrade_kills_in_session_ux).
//   - The footer button always shows ONE label:
//       "Open live preview · driving: {code}"
//     The internal symbol name (formatSandboxLabel) and the "sandbox" compose
//     service it points at are unchanged — only the user-facing label flipped
//     per 2026-05-24 portal topology consolidation spec §8.1.
//   - "Driving" = the build whose preview port is live; on ties, the most
//     recently active. When nothing is running, label says "idle".
//
// Splitting this into a pure helper makes the contract testable without
// rendering the component or wiring React Flow.

/** Minimal build shape the driver helper reads. Keep this loose so callers
 *  can pass either FeatureBuildRow or a projection from getBuildSandboxState
 *  without coupling this module to either type. */
export type SandboxDriverCandidate = {
  /** Semantic FB-* identifier. Used as the displayed label. */
  buildCode: string;
  /** Sandbox port reported by the runtime. null/0 means no live preview. */
  sandboxPort: number | null;
  /** Most recent activity timestamp (e.g. updatedAt). Used for tie-break. */
  lastActivityAt: Date | null;
};

/**
 * Pick the build that owns the sandbox right now.
 *
 * Rules:
 *   1. Filter out candidates without a live port (port is null, 0, or NaN).
 *   2. If none qualify, return null (footer shows "idle").
 *   3. If exactly one qualifies, return it.
 *   4. On a tie, pick the one with the most recent lastActivityAt. Builds
 *      with null lastActivityAt sort last.
 *   5. On a deeper tie (same timestamp), sort by buildCode ascending so the
 *      result is deterministic (no flicker between identical states).
 */
export function computeDrivingBuild(
  candidates: readonly SandboxDriverCandidate[],
): SandboxDriverCandidate | null {
  if (!candidates || candidates.length === 0) return null;

  const live = candidates.filter((c) => isValidSandboxPort(c.sandboxPort));
  if (live.length === 0) return null;
  if (live.length === 1) return live[0];

  // Sort: most recent activity first; nulls last; tie-break by buildCode asc.
  const sorted = [...live].sort((a, b) => {
    const aMs = a.lastActivityAt?.getTime() ?? -Infinity;
    const bMs = b.lastActivityAt?.getTime() ?? -Infinity;
    if (aMs !== bMs) return bMs - aMs;
    return a.buildCode.localeCompare(b.buildCode);
  });
  return sorted[0];
}

/** Sandbox port validation — accepts only positive integers within the TCP
 *  range. Used both by the driver helper and the button render path so the
 *  rule lives in one place. */
export function isValidSandboxPort(port: number | null | undefined): port is number {
  if (port == null) return false;
  if (typeof port !== "number") return false;
  if (!Number.isFinite(port)) return false;
  if (!Number.isInteger(port)) return false;
  if (port <= 0) return false;
  if (port > 65535) return false;
  return true;
}

/** Format the label used by OpenSandboxButton. Stays in this module so the
 *  string contract is centralized.
 *
 *  Customer-facing wording: "Live preview" (the user-job-named role per the
 *  portal topology consolidation spec). The function name keeps "Sandbox"
 *  because that is the compose-service the link points at — the rename is
 *  *user-facing only*, not a code-symbol rename. See spec §6 and §8.3. */
export function formatSandboxLabel(drivingBuildCode: string | null): string {
  return `Open live preview · driving: ${drivingBuildCode ?? "idle"}`;
}
