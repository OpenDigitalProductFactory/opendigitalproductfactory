// apps/web/lib/operate/repo-file-inventory.ts
//
// BI-1A1EC5EC — the source-file inventory the filing-time implementation scan
// matches against.
//
// Separated from implementation-scan.ts so the scanner stays pure and testable
// without a filesystem; this module is the only part that touches disk.
//
// DELIBERATELY NOT THE CODE GRAPH. BI-1A3CC151 is open — the code-graph index is
// built off a behind-main branch and is missing files. A scan on a stale index
// yields FALSE NEGATIVES, which is worse than no scan at all: it manufactures
// confidence in exactly the place where confidence already failed. A walk of the
// working tree cannot be stale, needs no database, and needs no index refresh.
//
// Returns [] rather than throwing when there is no checkout (a customer install
// ships no source). Filing must never fail because an advisory could not run.

import { lazyFsPromises, lazyPath, getCwd } from "@/lib/shared/lazy-node";

/** Directories that never hold a candidate implementation. */
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build", "coverage", "generated",
  ".turbo", ".pnpm-store", "out", ".vercel", ".cache",
]);

/** Extensions worth considering as "an implementation of something". */
const CODE_EXT = /\.(ts|tsx|mts|mjs|js|jsx|prisma|sql|sh|ps1|ya?ml)$/i;

/** Tests describe an implementation rather than being one. */
const TEST_FILE = /\.(test|spec)\./;

/** Bound the walk. The repo is ~10k source files; this is headroom, not a target. */
const MAX_FILES = 40_000;

function resolveProjectRoot(): string {
  const path = lazyPath();
  if (process.env.PROJECT_ROOT) return path.resolve(process.env.PROJECT_ROOT);
  // Mirrors getProjectRoot() in integrate/codebase-tools.ts: cwd is apps/web.
  return path.resolve(getCwd(), "..", "..");
}

/**
 * Repo-relative POSIX paths of every source file that could be an existing
 * implementation.
 *
 * @returns [] when the tree is unreadable or absent — never throws
 */
export async function listRepoSourceFiles(): Promise<string[]> {
  const fs = lazyFsPromises();
  const path = lazyPath();
  const root = resolveProjectRoot();
  const out: string[] = [];

  const walk = async (absDir: string, rel: string): Promise<void> => {
    if (out.length >= MAX_FILES) return;
    let entries: Array<{ name: string; isDirectory(): boolean }>;
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
      return; // an unreadable subtree is not a reason to fail the whole scan
    }
    for (const entry of entries) {
      if (out.length >= MAX_FILES) return;
      // `.github` is kept: workflows are implementations (the recheck workflow
      // in PR #4012 is exactly the kind of thing a filer should be shown).
      if (entry.name.startsWith(".") && entry.name !== ".github") continue;
      if (SKIP_DIRS.has(entry.name)) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(path.join(absDir, entry.name), childRel);
      } else if (CODE_EXT.test(entry.name) && !TEST_FILE.test(entry.name)) {
        out.push(childRel);
      }
    }
  };

  try {
    await walk(root, "");
  } catch {
    return [];
  }
  return out;
}
