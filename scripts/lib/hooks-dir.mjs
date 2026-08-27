// Resolve a repo-relative directory from a module URL (BI-5CBDC146).
//
// `new URL("../.githooks/", import.meta.url).pathname` is NOT a filesystem
// path. On Windows it yields "/D:/repo/.githooks/" — a leading slash in front
// of the drive letter — and `path.join` turns that into "\D:\repo\.githooks\",
// which no fs call can open. Every read threw ENOENT, every write threw, and
// both landed in a bare `catch {}`. The result was silent: the pre-push shim
// was never converged, `.githooks/pre-push` stayed the stock git-lfs hook, and
// a clean `git push` on Windows meant the DPF gate never ran — not that it
// passed.
//
// `fileURLToPath` is the only correct conversion. It is a no-op difference on
// POSIX, which is why this survived review and CI: Linux CI cannot reproduce it.

import { fileURLToPath } from "node:url";

/** `.githooks/` relative to a module living directly under `scripts/`. */
export const HOOKS_DIR_FROM_SCRIPTS = "../.githooks/";

/**
 * True when a string is a URL pathname that was mistaken for a filesystem
 * path — the "/D:/..." or "\D:\..." shape with a separator before the drive
 * letter. POSIX absolute paths ("/srv/repo") do not match.
 */
export function looksLikeUrlPathname(value) {
  return /^[\\/][A-Za-z]:/.test(value);
}

/**
 * Resolve `relative` against `moduleUrl` and return a real filesystem path.
 *
 * @param {string} moduleUrl - the caller's `import.meta.url`
 * @param {string} [relative] - directory relative to that module
 * @returns {string} an absolute path `fs` can open on every platform
 */
export function resolveHooksDir(moduleUrl, relative = HOOKS_DIR_FROM_SCRIPTS) {
  return fileURLToPath(new URL(relative, moduleUrl));
}
