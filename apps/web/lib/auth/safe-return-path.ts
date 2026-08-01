// One rule for "is this a path we are willing to send a signed-in user to?".
//
// Any place that reads a destination out of a URL parameter and redirects to it is an open
// redirect waiting to happen: an attacker sends `/login?callbackUrl=https://evil.test`, the
// victim signs in, and lands on a convincing fake with a fresh session in their history.
// The defence is to accept ONLY same-origin relative paths, and to be strict about the
// shapes that look relative but are not.
//
// Shared deliberately: the login page and the attention reach route both need this, and two
// copies of a security predicate is how one of them ends up subtly weaker than the other.

/** Where a signed-in user goes when no safe destination was supplied. */
export const DEFAULT_RETURN_PATH = "/workspace";

/** Control characters (CR/LF enable redirect splitting), space, and DEL. */
const UNSAFE_CHARS = new RegExp("[\u0000-\u0020\u007f]");

/**
 * True when `value` is a safe in-app destination.
 *
 * Rejected, and why:
 * - absolute URLs (`https://evil.test`) — different origin
 * - protocol-relative (`//evil.test`) — browsers treat this as absolute
 * - backslash variants (`/\evil.test`) — some browsers normalise `\` to `/`
 * - anything not starting with `/` — resolves relative to the current path, so it can
 *   escape into a different app area in ways the caller did not intend
 * - control characters and whitespace — used to smuggle past naive prefix checks
 */
export function isSafeReturnPath(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > 2048) return false;
  if (UNSAFE_CHARS.test(value)) return false;
  if (!value.startsWith("/")) return false;
  // `//host` and `/\host` are both treated as protocol-relative by at least one browser.
  if (value.startsWith("//") || value.startsWith("/\\")) return false;
  // Any backslash at all: cheaper to reject than to reason about per-browser normalisation.
  if (value.includes("\\")) return false;
  return true;
}

/**
 * The safe destination for a supplied value, falling back rather than throwing — a bad
 * callbackUrl should sign the user in and land them somewhere sane, not block the login.
 */
export function resolveReturnPath(
  value: unknown,
  fallback: string = DEFAULT_RETURN_PATH,
): string {
  return isSafeReturnPath(value) ? value : fallback;
}
