#!/usr/bin/env node
/**
 * Plan 2026-09-08 §10.5 S7 — CI ratchet: no NEW local `slugify` helper.
 *
 * The kebab-case slug transform has one home:
 *
 *   import { slugify } from "@/lib/shared/slugify";
 *
 * Callers that need a length cap or a fallback compose around it
 * (`slugify(x).slice(0, 64)`, `slugify(x) || "fallback"`) rather than defining
 * their own `slugify`. This guard flags any other definition whose name starts
 * with `slugify` (function declaration or const/let/var binding).
 *
 * ALLOWLIST is a closed backlog of copies that were NOT migrated, each with the
 * reason. Slug output is often persisted (URLs, DB keys, seed ids), so a copy
 * whose output differs from the shared helper for any input stays where it is:
 * migrating it would change stored slugs. Do not add entries for new code.
 *
 * Scope: apps/, packages/, scripts/ and services/ (source only; tests,
 * declaration files, fixtures and build output excluded).
 *
 * Run: node scripts/check-no-local-slugify.mjs
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The one sanctioned home — never flagged.
export const CANONICAL = "apps/web/lib/shared/slugify.ts";

export const SCAN_ROOTS = ["apps", "packages", "scripts", "services"];

// Closed backlog: path -> why the copy stays. Do NOT add entries.
export const ALLOWLIST = new Map([
  [
    "apps/web/components/workbooks/AddColumnButton.tsx",
    "different output: `_` separator (snake_case column key stored in the workbook schema)",
  ],
  [
    "apps/web/lib/authority/bootstrap-bindings.ts",
    "different output: uppercase, strips a leading `/`, caps input at 256 chars (authority binding ids)",
  ],
  [
    "apps/web/lib/docs/doc-link-resolver.mjs",
    "different output: heading-anchor rules (drops punctuation, keeps `-`, folds whitespace); plain .mjs cannot import the TS helper",
  ],
  [
    "apps/web/lib/wiki/craft-override.ts",
    "different output: heading-anchor rules (drops punctuation, keeps `-`, folds whitespace)",
  ],
  [
    "packages/db/src/portfolio-sources/project-archetype-supply.ts",
    "identical output, but packages/db cannot import apps/web; migrate when a package-level home exists",
  ],
  [
    "packages/db/src/reference-model-import.ts",
    "different output: `_` separator plus a `_v<version>` suffix (reference-model keys)",
  ],
  [
    "packages/db/src/seed-ea-reference-models.ts",
    "different output: `_` separator (seeded reference-model keys)",
  ],
  [
    "packages/db/src/taxonomy-seed-entries.ts",
    "different output: `_` separator (seeded taxonomy ids)",
  ],
]);

// A local slugify* DEFINITION, not a call site, an import or a re-export.
export const DEFINITION_PATTERNS = [
  /\b(?:export\s+)?(?:async\s+)?function\s+slugify\w*\s*[(<]/,
  /\b(?:export\s+)?(?:const|let|var)\s+slugify\w*\s*[:=]/,
];

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".mjs", ".js", ".cjs"];
const SKIPPED_DIRS = new Set([
  "node_modules", ".next", ".expo", "__snapshots__", "dist", "coverage",
  "generated", "__tests__", "__fixtures__", "fixtures", ".turbo",
]);

/** True for a test, spec, declaration or non-source file. */
export function isExcludedFile(name) {
  if (/\.d\.[cm]?ts$/.test(name)) return true;
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(name)) return true;
  return !SOURCE_EXTENSIONS.some((ext) => name.endsWith(ext));
}

function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith("*") || t.startsWith("//") || t.startsWith("/*");
}

/** 1-based line numbers + text of every local slugify* definition in `body`. */
export function findDefinitionLines(body) {
  const hits = [];
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isCommentLine(line)) continue;
    if (/^\s*(?:import|export\s*\{)/.test(line)) continue;
    if (DEFINITION_PATTERNS.some((p) => p.test(line))) hits.push({ line: i + 1, text: line.trim() });
  }
  return hits;
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    // Skip excluded names BEFORE stat: a dangling link throws ENOENT on stat.
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
    const dir = join(root, scanRoot);
    if (!existsSync(dir)) continue;
    for (const file of walk(dir)) {
      const rel = relative(root, file).replace(/\\/g, "/");
      if (rel === CANONICAL || ALLOWLIST.has(rel)) continue;
      for (const h of findDefinitionLines(readFileSync(file, "utf8"))) violations.push({ file: rel, ...h });
    }
  }
  return violations;
}

/** Allowlisted files that no longer define a slugify* helper — stale entries. */
export function findStaleAllowlist(root = REPO_ROOT) {
  const stale = [];
  for (const rel of ALLOWLIST.keys()) {
    const file = join(root, rel);
    if (!existsSync(file) || findDefinitionLines(readFileSync(file, "utf8")).length === 0) stale.push(rel);
  }
  return stale;
}

function main() {
  const violations = scanRepo();
  const stale = findStaleAllowlist();

  if (violations.length > 0) {
    console.error("");
    console.error("ERROR: plan 2026-09-08 S7 — a NEW local `slugify` helper was added.");
    console.error("");
    console.error("Import the shared slug transform and compose a cap or fallback around it:");
    console.error('  import { slugify } from "@/lib/shared/slugify";');
    console.error('  slugify(title).slice(0, 64)   slugify(title) || "untitled"');
    console.error("");
    console.error("Offending definitions:");
    for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.text}`);
    console.error("");
    process.exit(1);
  }

  if (stale.length > 0) {
    console.error("");
    console.error("ERROR: plan 2026-09-08 S7 — the slugify allowlist is stale.");
    console.error("These files no longer define a local slugify helper;");
    console.error("delete them from ALLOWLIST in scripts/check-no-local-slugify.mjs:");
    for (const f of stale) console.error(`  ${f}`);
    console.error("");
    process.exit(1);
  }

  console.log(
    `✓ No new local slugify helpers (${ALLOWLIST.size} allowlisted copies with a recorded reason).`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
