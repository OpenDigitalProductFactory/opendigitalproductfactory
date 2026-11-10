#!/usr/bin/env node
/**
 * Plan 2026-09-08 §10.5 S3 — CI ratchet: no NEW hand-written pnpm-lock parser.
 *
 * Five scripts used to carry their own line parser for pnpm-lock.yaml (SBOM
 * generator, release-age gate, runtime surface, sandbox freshness, pinned
 * guard TypeScript). They drifted: the release-age gate's `packages:` walk also
 * matched deeper-indented lines and produced 107 junk keys across the two
 * lockfiles. They now compose one reader:
 *
 *   import { parseImporters, parsePackageKeys, parseSnapshots } from "./lib/pnpm-lock.mjs";
 *
 * This guard flags any other script that walks the lockfile's `importers:` or
 * `snapshots:` section by hand. Those two headers exist only in a pnpm lockfile
 * (pnpm-workspace.yaml has neither), so the signal has no false positives from
 * workspace-file parsing. ALLOWLIST is a closed migration backlog and starts
 * empty: every parser was migrated in the same change.
 *
 * Scope: scripts/**\/*.mjs, tests excluded. The in-portal parser
 * (apps/web/lib/assurance/pnpm-lock-parser.ts) runs in a different runtime and
 * is out of scope.
 *
 * Run: node scripts/check-no-local-lockfile-parser.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The one sanctioned home for lockfile parsing — never flagged.
export const CANONICAL = "scripts/lib/pnpm-lock.mjs";

// Closed migration backlog. Do NOT add entries — import the shared reader.
export const ALLOWLIST = new Set([]);

// A lockfile section header used as a parse anchor: a string literal
// ("importers:") or a regex literal (/^snapshots:/).
export const PARSER_PATTERNS = [
  /["'`](?:importers|snapshots):["'`]/,
  /\/\^\s*(?:importers|snapshots):/,
];

function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith("*") || t.startsWith("//") || t.startsWith("/*");
}

/** 1-based line numbers + text of every hand-parse anchor in `body`. */
export function findParserLines(body) {
  const hits = [];
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isCommentLine(line)) continue;
    if (PARSER_PATTERNS.some((p) => p.test(line))) hits.push({ line: i + 1, text: line.trim() });
  }
  return hits;
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "fixtures" || entry === "__fixtures__") continue;
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      yield* walk(full);
    } else if (s.isFile() && full.endsWith(".mjs") && !full.endsWith(".test.mjs")) {
      yield full;
    }
  }
}

/** Scan scripts/ under `root`; return hand-parse anchors outside the allowlist. */
export function scanRepo(root = REPO_ROOT) {
  const violations = [];
  for (const file of walk(join(root, "scripts"))) {
    const rel = relative(root, file).replace(/\\/g, "/");
    if (rel === CANONICAL || rel === "scripts/check-no-local-lockfile-parser.mjs" || ALLOWLIST.has(rel)) continue;
    for (const h of findParserLines(readFileSync(file, "utf8"))) violations.push({ file: rel, ...h });
  }
  return violations;
}

/** Allowlisted files that no longer hand-parse — stale entries to prune. */
export function findStaleAllowlist(root = REPO_ROOT) {
  const stale = [];
  for (const rel of ALLOWLIST) {
    let body;
    try {
      body = readFileSync(join(root, rel), "utf8");
    } catch {
      stale.push(rel);
      continue;
    }
    if (findParserLines(body).length === 0) stale.push(rel);
  }
  return stale;
}

function main() {
  const violations = scanRepo();
  const stale = findStaleAllowlist();
  if (violations.length > 0) {
    console.error("\nERROR: a script parses pnpm-lock.yaml by hand.\n");
    console.error("There is one lockfile reader. Import it instead:");
    console.error('  import { parseImporters, parsePackageKeys, parseSnapshots } from "./lib/pnpm-lock.mjs";\n');
    for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.text}`);
    console.error("");
    process.exit(1);
  }
  if (stale.length > 0) {
    console.error("\nERROR: stale ALLOWLIST entries in scripts/check-no-local-lockfile-parser.mjs:");
    for (const f of stale) console.error(`  ${f}`);
    console.error("");
    process.exit(1);
  }
  console.log(`✓ No hand-written pnpm-lock parsers outside ${CANONICAL}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
