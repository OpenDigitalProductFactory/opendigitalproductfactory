/**
 * Path normalization for plugin-entry equality comparisons.
 *
 * Background (Phase 5 functional finding): `claude plugin install --scope local`
 * records `projectPath` in `installed_plugins.json` using Windows-native
 * backslash-escaped form (e.g. `"D:\\DPF\\.claude\\worktrees\\X"`), while
 * Node's `path.resolve` and Git/MSYS conventions hand the planning library a
 * forward-slash form (`"D:/DPF/.claude/worktrees/X"`). Strict equality on
 * these two strings is false, so the planner re-plans a "create" on every
 * run — accumulating duplicate entries indefinitely.
 *
 * `normalizeRepoPath` collapses these forms to a single canonical comparison
 * key. It is NOT a real path-resolver: it does not touch the filesystem, does
 * not follow symlinks, does not consult CWD. It is a byte-level normalization
 * sufficient for equality.
 */

/**
 * Normalize a repo-path string for equality compares between Windows-native
 * (backslash) and forward-slash forms.
 *
 * Rules:
 *   - Convert all `\\` to `/` and all `\` to `/`.
 *   - Collapse multiple consecutive `/` to a single `/`.
 *   - Strip trailing `/`.
 *   - Lowercase the Windows drive-letter prefix (`D:` → `d:`); leave the
 *     rest of the path case-preserved (Windows is case-insensitive but
 *     contributor memory + git both preserve casing past the drive).
 *
 * Examples:
 *   "D:\\DPF\\.claude\\worktrees\\X"  → "d:/DPF/.claude/worktrees/X"
 *   "D:/DPF/.claude/worktrees/X"      → "d:/DPF/.claude/worktrees/X"
 *   "/d/DPF/.claude/worktrees/X"      → "/d/DPF/.claude/worktrees/X"  (MSYS bash; unchanged)
 *   "/home/dev/dpf"                   → "/home/dev/dpf"               (POSIX; unchanged)
 *   "C:\\Users\\Test\\dpf\\"          → "c:/Users/Test/dpf"
 *
 * Note on MSYS form (`/d/DPF/...`): we deliberately do NOT translate this to
 * Windows-native form because the planning library treats it as a distinct
 * shell convention. The shell adapter is responsible for using one convention
 * consistently per session — typically the Node-resolved form. If the operator's
 * `installed_plugins.json` has entries in BOTH MSYS and Windows-native form for
 * the same worktree (which can happen if two different sessions installed under
 * the same repo via different shells), they will compare unequal and the
 * stale-entry reconcile flow handles cleanup. This is the right semantics:
 * MSYS-form and Windows-native form are different shell conventions and the
 * planner should not silently coalesce them.
 */
export function normalizeRepoPath(input: string): string {
  if (!input) return input;

  // Normalize separators: \\ -> /, \ -> /. Then collapse repeated /.
  let normalized = input.replace(/\\+/g, "/").replace(/\/+/g, "/");

  // Strip trailing slash (but keep a single "/" root).
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }

  // Lowercase Windows drive letter (D: → d:). Match at start only; don't
  // touch path segments that happen to contain a colon mid-string.
  if (normalized.length >= 2 && normalized[1] === ":") {
    normalized = normalized[0].toLowerCase() + normalized.slice(1);
  }

  return normalized;
}

/**
 * True iff two path strings refer to the same logical filesystem location
 * after normalization. Symmetric.
 */
export function repoPathsMatch(a: string, b: string): boolean {
  return normalizeRepoPath(a) === normalizeRepoPath(b);
}
