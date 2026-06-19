/**
 * Private-paths boundary — Phase 1 of Private/Public Change Segregation.
 * Spec: docs/superpowers/specs/2026-06-18-private-public-change-segregation-design.md
 *
 * A declarative, gitignore-style list of paths that must NEVER appear in an
 * upstream contribution diff, regardless of a change's disposition. Patterns
 * are sourced from a checked-in `.dpf/private-paths` manifest at the repo root
 * plus operator overrides in the `PrivatePathRule` table.
 *
 * The boundary is structural and fail-closed by construction: matching is
 * deliberately liberal (a path under any matched dir is private), so when in
 * doubt a path is treated as private — excluded from sharing — never shared by
 * accident. The outbound contribution diff is filtered through
 * `stripPrivatePathsFromDiff` before it is ever pushed to a remote.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

// ─── Manifest parsing ─────────────────────────────────────────────────────────

/**
 * Parse a `.dpf/private-paths` manifest body into gitignore-style patterns.
 * Blank lines and `#` comment lines are dropped; surrounding whitespace is
 * trimmed. Order is preserved and duplicates removed.
 */
export function parsePrivatePathManifest(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (!seen.has(line)) {
      seen.add(line);
      out.push(line);
    }
  }
  return out;
}

// ─── Glob matching ──────────────────────────────────────────────────────────

/** Convert a single glob segment-body into a regex source fragment. */
function globToRegexSource(glob: string): string {
  let re = "";
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // `**/` matches zero or more path segments; bare `**` matches anything.
        if (glob[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 3;
          continue;
        }
        re += ".*";
        i += 2;
        continue;
      }
      re += "[^/]*"; // single `*` does not cross a path separator
      i += 1;
      continue;
    }
    if (c === "?") {
      re += "[^/]";
      i += 1;
      continue;
    }
    if ("\\^$.|+()[]{}".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
    i += 1;
  }
  return re;
}

/** Compile one gitignore-style pattern into a path predicate. */
function compilePattern(pattern: string): ((path: string) => boolean) | null {
  let p = pattern.trim();
  if (!p || p.startsWith("#")) return null;

  const anchored = p.startsWith("/");
  if (anchored) p = p.slice(1);
  // A trailing slash signals a directory but we already match subtrees, so
  // strip it for a uniform body.
  p = p.replace(/\/+$/, "");
  if (!p) return null;

  const hasSlash = p.includes("/");
  // Unanchored, slash-free patterns (e.g. `secrets`) match at any depth — the
  // gitignore convention. Anchored or slash-bearing patterns match from root.
  const prefix = anchored || hasSlash ? "^" : "^(?:.*/)?";
  // Match the path itself OR anything beneath it (conservative / fail-closed):
  // `proprietary` matches `proprietary` and `proprietary/foo.ts`.
  const suffix = "(?:/.*)?$";
  const body = globToRegexSource(p);
  const re = new RegExp(prefix + body + suffix);
  return (path: string) => re.test(normalizePath(path));
}

/** Normalize a path for matching: strip leading `./` and `/`, use `/` seps. */
function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.?\/+/, "");
}

/**
 * Compile a set of patterns into a single predicate. The predicate returns
 * true when a path is private (matches any pattern). An empty pattern set
 * matches nothing.
 */
export function compilePrivatePathMatcher(patterns: string[]): (path: string) => boolean {
  const tests = patterns.map(compilePattern).filter((t): t is (path: string) => boolean => t !== null);
  if (tests.length === 0) return () => false;
  return (path: string) => tests.some((t) => t(path));
}

/** Convenience: does `path` match any of `patterns`? */
export function matchesPrivatePath(path: string, patterns: string[]): boolean {
  return compilePrivatePathMatcher(patterns)(path);
}

// ─── Unified-diff splitting & stripping ───────────────────────────────────────

export interface DiffFileBlock {
  /** Candidate paths this block touches (a-side, b-side, renames). */
  paths: string[];
  /** The verbatim lines of this block. */
  text: string;
}

export interface SplitDiff {
  /** Any preamble before the first `diff --git` header (kept verbatim). */
  preamble: string;
  blocks: DiffFileBlock[];
}

const DIFF_GIT_HEADER = /^diff --git a\/(.+?) b\/(.+)$/;
const MINUS_HEADER = /^--- (?:a\/)?(.+)$/;
const PLUS_HEADER = /^\+\+\+ (?:b\/)?(.+)$/;
const RENAME_HEADER = /^rename (?:from|to) (.+)$/;

/**
 * Split a unified (git) diff into per-file blocks. Recognizes `diff --git`
 * headers; falls back to `--- a/ … +++ b/` boundaries for non-git diffs.
 */
export function splitUnifiedDiffByFile(diff: string): SplitDiff {
  const lines = diff.split("\n");
  const blocks: DiffFileBlock[] = [];
  const preambleLines: string[] = [];
  let current: { paths: Set<string>; lines: string[] } | null = null;
  let sawHeader = false;

  const flush = () => {
    if (current) {
      blocks.push({ paths: [...current.paths], text: current.lines.join("\n") });
      current = null;
    }
  };

  for (const line of lines) {
    const gitMatch = line.match(DIFF_GIT_HEADER);
    if (gitMatch) {
      sawHeader = true;
      flush();
      current = { paths: new Set([gitMatch[1], gitMatch[2]]), lines: [line] };
      continue;
    }
    if (!sawHeader && line.startsWith("--- ")) {
      // Non-git diff: a `--- a/path` line begins a new file section.
      flush();
      const m = line.match(MINUS_HEADER);
      current = { paths: new Set(m ? [m[1]] : []), lines: [line] };
      continue;
    }
    if (current) {
      current.lines.push(line);
      const plus = line.match(PLUS_HEADER);
      if (plus && plus[1] !== "/dev/null") current.paths.add(plus[1]);
      const minus = line.match(MINUS_HEADER);
      if (minus && line.startsWith("--- ") && minus[1] !== "/dev/null") current.paths.add(minus[1]);
      const rename = line.match(RENAME_HEADER);
      if (rename) current.paths.add(rename[1]);
    } else {
      preambleLines.push(line);
    }
  }
  flush();

  return { preamble: preambleLines.join("\n"), blocks };
}

export interface StripResult {
  /** The diff with private-path file blocks removed. */
  kept: string;
  /** Distinct paths that were stripped (for plain-language reporting). */
  strippedPaths: string[];
  /** True when something was removed. */
  didStrip: boolean;
}

/**
 * Remove every file block whose touched paths include a private path. A block
 * is dropped if ANY of its candidate paths is private (conservative). The
 * preamble is always retained.
 */
export function stripPrivatePathsFromDiff(
  diff: string,
  isPrivate: (path: string) => boolean,
): StripResult {
  if (!diff || !diff.trim()) return { kept: diff ?? "", strippedPaths: [], didStrip: false };
  const { preamble, blocks } = splitUnifiedDiffByFile(diff);
  const keptParts: string[] = [];
  if (preamble.trim()) keptParts.push(preamble);
  const stripped = new Set<string>();
  for (const block of blocks) {
    const privateHit = block.paths.find((p) => isPrivate(p));
    if (privateHit) {
      for (const p of block.paths) if (isPrivate(p)) stripped.add(p);
      continue;
    }
    keptParts.push(block.text);
  }
  return {
    kept: keptParts.join("\n"),
    strippedPaths: [...stripped].sort(),
    didStrip: stripped.size > 0,
  };
}

// ─── Loading patterns from manifest + DB ───────────────────────────────────────

/** Minimal Prisma shape we need — avoids importing the full client type here. */
interface PrivatePathRuleReader {
  privatePathRule: { findMany: (args: { select: { pattern: true } }) => Promise<{ pattern: string }[]> };
}

export interface LoadPrivatePathOptions {
  /** Repo root to read `.dpf/private-paths` from. Defaults to process.cwd(). */
  repoRoot?: string;
  /** Prisma client to read PrivatePathRule overrides. Optional. */
  prisma?: PrivatePathRuleReader | null;
}

/**
 * Load the effective private-path patterns: the checked-in manifest first,
 * then any operator overrides from the database. Missing manifest or DB is
 * non-fatal — an absent source contributes no patterns.
 */
export async function loadPrivatePathPatterns(opts: LoadPrivatePathOptions = {}): Promise<string[]> {
  const repoRoot = opts.repoRoot ?? process.cwd();
  const patterns: string[] = [];

  try {
    const text = await readFile(join(repoRoot, ".dpf", "private-paths"), "utf8");
    patterns.push(...parsePrivatePathManifest(text));
  } catch {
    // No manifest — fine, DB and disposition still apply.
  }

  if (opts.prisma) {
    try {
      const rows = await opts.prisma.privatePathRule.findMany({ select: { pattern: true } });
      for (const r of rows) {
        const p = r.pattern.trim();
        if (p && !patterns.includes(p)) patterns.push(p);
      }
    } catch {
      // PrivatePathRule may not exist yet (pre-migration) — non-fatal.
    }
  }

  return patterns;
}
