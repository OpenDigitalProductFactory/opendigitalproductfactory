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

// ── BI-F381D902: catch skew that never reaches the crash boundary ────────────
//
// The crash boundary (app/(shell)/error.tsx) only auto-recovers skew errors
// that BUBBLE UP to it. Many interactions swallow the failure instead — the
// coworker composer, for example, catches its send error and flips the message
// to a "failed" state, so the boundary never sees it and the user is left with
// a dead button and no recovery hint. The global skew sentinel
// (components/shell/DeploymentSkewBanner) closes that gap two ways, both built
// on the helpers below: it listens for skew errors at the window level (for the
// throws that aren't swallowed) AND proactively compares the tab's boot
// identity to the running deployment on tab refocus (for the swallowed case).

/** Pulls a message string out of an Error, string, ErrorEvent, or
 *  PromiseRejectionEvent so window-level listeners can be matched with
 *  {@link isDeploymentSkewError}. */
export function skewMessageFromReason(reason: unknown): string {
  if (reason == null) return "";
  if (typeof reason === "string") return reason;
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "object") {
    const record = reason as { message?: unknown; reason?: unknown; error?: unknown };
    if (typeof record.message === "string" && record.message) return record.message;
    if (record.reason != null && record.reason !== reason) return skewMessageFromReason(record.reason);
    if (record.error != null && record.error !== reason) return skewMessageFromReason(record.error);
  }
  return "";
}

/** True when an arbitrary error/event object carries a deployment-skew
 *  signature (convenience wrapper over {@link isDeploymentSkewError} for
 *  `unhandledrejection` / `error` listeners). */
export function isDeploymentSkewReason(reason: unknown): boolean {
  return isDeploymentSkewError(skewMessageFromReason(reason));
}

/** The version/bundle identity of a specific deployment. */
export type DeploymentIdentity = { version?: string | null; bundleHash?: string | null };

function isKnownIdentityValue(value: string | null | undefined): value is string {
  return Boolean(value) && value !== "unknown";
}

/**
 * True when the running deployment's identity differs from the tab's boot
 * identity. Only a change between two *known* values counts — any "unknown" or
 * missing value on either side returns false.
 *
 * Anti-loop invariant (BI-864E83B0-followup): boot hash and the API hash both
 * derive from getDeployedSha/DEPLOYED_SHA, and a bare `next dev` reports
 * "unknown" on both. Treating "unknown" as a mismatch would drive a permanent
 * reload loop, so it never counts.
 */
export function isBundleMismatch(
  boot: DeploymentIdentity | null | undefined,
  served: DeploymentIdentity | null | undefined,
): boolean {
  if (!boot || !served) return false;
  const versionChanged =
    isKnownIdentityValue(served.version) &&
    isKnownIdentityValue(boot.version) &&
    served.version !== boot.version;
  const bundleChanged =
    isKnownIdentityValue(served.bundleHash) &&
    isKnownIdentityValue(boot.bundleHash) &&
    served.bundleHash !== boot.bundleHash;
  return versionChanged || bundleChanged;
}

/** Reads the boot identity injected as window.__DPF_BOOT__ by the root layout. */
export function readBootIdentity(): DeploymentIdentity | null {
  if (typeof window === "undefined") return null;
  const boot = (window as { __DPF_BOOT__?: DeploymentIdentity }).__DPF_BOOT__;
  return boot ?? null;
}

/**
 * Fetches the running deployment's identity from the internal quiescence-state
 * route (the same endpoint PlatformBanner compares against). Best-effort:
 * returns null on any failure — the route can be briefly unreachable mid-swap —
 * so callers treat null as "can't tell yet", never as a mismatch.
 */
export async function fetchServedIdentity(): Promise<DeploymentIdentity | null> {
  if (typeof window === "undefined") return null;
  try {
    const res = await fetch("/api/internal/quiescence-state", { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as DeploymentIdentity;
    return { version: body.version ?? null, bundleHash: body.bundleHash ?? null };
  } catch {
    return null;
  }
}
