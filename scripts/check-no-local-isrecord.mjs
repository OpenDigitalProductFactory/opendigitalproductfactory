#!/usr/bin/env node
/**
 * BI-6A505BFF (EP-8DC217EB BET-6) — CI ratchet: no NEW local `isRecord` helper.
 *
 * The object guard `isRecord(v): v is Record<string, unknown>` (also spelled
 * `isPlainObject`) was hand-copied into 35+ modules, each re-deriving the same
 * `typeof === "object" && !== null && !Array.isArray` predicate. Each import
 * boundary now has one sanctioned home:
 *
 *   apps/web            import { isRecord } from "@/lib/shared/coerce";
 *                       (plain-Node callers: apps/web/lib/shared/is-record.mjs)
 *   packages/*          import { isRecord } from "@dpf/validators";
 *                       (packages cannot import from apps/web)
 *   scripts/lib         import { isRecord } from "./is-record.mjs";
 *                       (plain .mjs cannot import TypeScript)
 *
 * Any other local definition fails CI. ALLOWLIST is a closed migration backlog:
 * it emptied when plan 2026-09-08 §10.5 S5 migrated the last copies. Do not add
 * entries — import the home for your boundary instead.
 *
 * Scope (source only; test files, fixtures and build output excluded):
 * apps/web/lib, apps/web/components, packages/<pkg>/ and scripts/lib.
 *
 * A predicate with DIFFERENT semantics must not reuse these names (for example
 * a prototype check is `hasPlainPrototype`), so the names stay unambiguous.
 *
 * Run: node scripts/check-no-local-isrecord.mjs
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The sanctioned homes, one per import boundary — never flagged.
export const CANONICAL = new Set([
  "apps/web/lib/shared/coerce.ts",
  "apps/web/lib/shared/is-record.mjs",
  "packages/validators/src/guards.ts",
  "scripts/lib/is-record.mjs",
]);

// Directories scanned, relative to the repo root. `packages` is walked whole
// (every workspace package); the others are single trees.
export const SCAN_ROOTS = ["apps/web/lib", "apps/web/components", "packages", "scripts/lib"];

// Closed migration backlog — empty since S5. Do NOT add entries.
export const ALLOWLIST = new Set([]);

// A local isRecord / isPlainObject DEFINITION (function decl or const arrow),
// not a call site or an import.
export const DEFINITION_PATTERNS = [
  /\b(?:export\s+)?function\s+(?:isRecord|isPlainObject)\s*[(<]/,
  /\b(?:export\s+)?(?:const|let)\s+(?:isRecord|isPlainObject)\s*[:=]/,
];

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".mjs", ".js", ".cjs"];
const SKIPPED_DIRS = new Set([
  "node_modules", ".next", "__snapshots__", "dist", "coverage",
  "generated", "__tests__", "__fixtures__", "fixtures", ".turbo",
]);

/** True for a test, spec or declaration file, which the guard never scans. */
export function isExcludedFile(name) {
  if (name.endsWith(".d.ts")) return true;
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(name)) return true;
  return !SOURCE_EXTENSIONS.some((ext) => name.endsWith(ext));
}

function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith("*") || t.startsWith("//") || t.startsWith("/*");
}

/** Return the 1-based line numbers + text of every local isRecord definition. */
export function findDefinitionLines(body) {
  const hits = [];
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isCommentLine(line)) continue;
    // Skip import lines — `import { isRecord }` is the sanctioned adoption.
    if (/^\s*import\b/.test(line)) continue;
    if (DEFINITION_PATTERNS.some((p) => p.test(line))) {
      hits.push({ line: i + 1, text: line.trim() });
    }
  }
  return hits;
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    // Skip excluded names BEFORE stat: a dangling node_modules link in a
    // worktree throws ENOENT on stat and used to fail the whole guard.
    if (SKIPPED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      yield* walk(full);
    } else if (s.isFile() && !isExcludedFile(entry)) {
      yield full;
    }
  }
}

/** Scan SCAN_ROOTS under `root`; return definitions outside the allowlist. */
export function scanRepo(root = REPO_ROOT) {
  const violations = [];
  for (const scanRoot of SCAN_ROOTS) {
    const scanDir = join(root, scanRoot);
    if (!existsSync(scanDir)) continue;
    for (const file of walk(scanDir)) {
      const rel = relative(root, file).replace(/\\/g, "/");
      if (CANONICAL.has(rel) || ALLOWLIST.has(rel)) continue;
      let body;
      try {
        body = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      for (const h of findDefinitionLines(body)) {
        violations.push({ file: rel, ...h });
      }
    }
  }
  return violations;
}

/** Allowlisted files that no longer define isRecord — stale entries to prune. */
export function findStaleAllowlist(root = REPO_ROOT) {
  const stale = [];
  for (const rel of ALLOWLIST) {
    let body;
    try {
      body = readFileSync(join(root, rel), "utf8");
    } catch {
      stale.push(rel); // file gone
      continue;
    }
    if (findDefinitionLines(body).length === 0) stale.push(rel);
  }
  return stale;
}

function main() {
  const violations = scanRepo();
  const stale = findStaleAllowlist();

  if (violations.length > 0) {
    console.error("");
    console.error("ERROR: BI-6A505BFF — a NEW local `isRecord` / `isPlainObject` helper was added.");
    console.error("");
    console.error("Each import boundary has one object guard. Import it instead of copying:");
    console.error('  apps/web     import { isRecord } from "@/lib/shared/coerce";');
    console.error('  packages/*   import { isRecord } from "@dpf/validators";');
    console.error('  scripts/lib  import { isRecord } from "./is-record.mjs";');
    console.error("");
    console.error("Offending definitions:");
    for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.text}`);
    console.error("");
    process.exit(1);
  }

  if (stale.length > 0) {
    console.error("");
    console.error("ERROR: BI-6A505BFF — the isRecord allowlist is stale.");
    console.error("These files no longer define a local isRecord (migrated or removed);");
    console.error("delete them from ALLOWLIST in scripts/check-no-local-isrecord.mjs:");
    for (const f of stale) console.error(`  ${f}`);
    console.error("");
    process.exit(1);
  }

  console.log(
    `✓ No local isRecord / isPlainObject helpers outside the ${CANONICAL.size} sanctioned homes (${ALLOWLIST.size} allowlisted).`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
