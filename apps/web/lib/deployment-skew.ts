// BI-D22D4607: detect "stale tab after a deployment" errors.
//
// When a self-upgrade swaps the portal image, every tab loaded from the
// previous build breaks in two well-known ways on its next interaction:
//
//  1. Server-action POSTs carry the old build's action IDs. The server logs
//     `Failed to find Server Action "<hash>"` and the client throws the
//     sanitized "An unexpected response was received from the server."
//  2. Lazy route/chunk loads 404 because the old build's hashed assets are
//     gone (ChunkLoadError / "Loading chunk N failed").
//
// Neither is a product defect — the fix is simply reloading the page onto the
// current build. The crash boundary uses this to auto-recover once instead of
// showing the "Something went wrong" screen (observed live 2026-07-06:
// /platform/ai/providers, 56 repeats of one stale action hash).
//
// Deliberately EXCLUDES generic network failures ("failed to fetch",
// "connection refused", …) — reloading doesn't fix an offline portal, and
// SelfUpgradeClient owns the swap-window retry loop for those.
const SKEW_PATTERNS =
  /unexpected response was received from the server|failed to find server action|loading chunk \S+ failed|chunkloaderror|failed to fetch dynamically imported module|importing a module script failed/i;

export function isDeploymentSkewError(message: string | null | undefined): boolean {
  if (!message) return false;
  return SKEW_PATTERNS.test(message);
}

/** sessionStorage key holding the epoch-ms of the last skew auto-reload. */
export const SKEW_RELOAD_KEY = "dpf-skew-reload-at";

/** Reload at most once per window — a second skew error this soon means the
 *  reload didn't fix it, so the boundary must fall through to the real crash
 *  screen instead of loop-reloading. */
export const SKEW_RELOAD_WINDOW_MS = 60_000;
