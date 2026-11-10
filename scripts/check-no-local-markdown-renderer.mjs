#!/usr/bin/env node
/**
 * Plan 2026-09-08 M5 — CI ratchet: one markdown renderer.
 *
 * Markdown renders through one primitive, on markdown-it with raw HTML off
 * (founder decision 2026-09-26, WWMD DI-D9292D812CFF):
 *
 *   import { renderMarkdown } from "@/lib/shared/markdown";
 *   <MarkdownHtml source={text} options={...} />      // components
 *
 * This guard fails on an import of a markdown parsing or rendering library
 * anywhere else. A second parser is how the old split happened: react-markdown
 * in five components and a hand-written serializer for export, each with its
 * own idea of which HTML is safe. The dependency gate refuses the retired
 * packages as direct dependencies; this guard also catches one reached
 * through another package.
 *
 * Scope: apps/, packages/, scripts/ and services/ (source only; tests,
 * declaration files, fixtures and build output excluded).
 *
 * Run: node scripts/check-no-local-markdown-renderer.mjs
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The one sanctioned home — never flagged.
export const CANONICAL = "apps/web/lib/shared/markdown.ts";

export const SCAN_ROOTS = ["apps", "packages", "scripts", "services"];

// Closed backlog: path -> why it keeps its own markdown library. Empty at
// introduction; do not add entries for new code.
export const ALLOWLIST = new Map();

// Markdown parsers and renderers, by package name or scope prefix.
export const MARKDOWN_LIBRARIES =
  /^(?:markdown-it|react-markdown|remark(?:-[\w-]+)?|rehype(?:-[\w-]+)?|unified|marked|micromark(?:-[\w-]+)?|mdast-util-[\w-]+|hast-util-to-html|markdown-to-jsx|showdown|commonmark|snarkdown)(?:\/.*)?$/;

const IMPORT_PATTERNS = [
  /\bfrom\s+["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  /^\s*import\s+["']([^"']+)["']/g,
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

/** 1-based line numbers, module names and text of every markdown-library import in `body`. */
export function findMarkdownImports(body) {
  const hits = [];
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isCommentLine(line)) continue;
    for (const pattern of IMPORT_PATTERNS) {
      for (const match of line.matchAll(pattern)) {
        if (MARKDOWN_LIBRARIES.test(match[1])) hits.push({ line: i + 1, module: match[1], text: line.trim() });
      }
    }
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

/** Scan SCAN_ROOTS under `root`; return imports outside the canonical home and the allowlist. */
export function scanRepo(root = REPO_ROOT) {
  const violations = [];
  for (const scanRoot of SCAN_ROOTS) {
    const dir = join(root, scanRoot);
    if (!existsSync(dir)) continue;
    for (const file of walk(dir)) {
      const rel = relative(root, file).replace(/\\/g, "/");
      if (rel === CANONICAL || ALLOWLIST.has(rel)) continue;
      for (const h of findMarkdownImports(readFileSync(file, "utf8"))) violations.push({ file: rel, ...h });
    }
  }
  return violations;
}

/** Allowlisted files that no longer import a markdown library — stale entries. */
export function findStaleAllowlist(root = REPO_ROOT) {
  const stale = [];
  for (const rel of ALLOWLIST.keys()) {
    const file = join(root, rel);
    if (!existsSync(file) || findMarkdownImports(readFileSync(file, "utf8")).length === 0) stale.push(rel);
  }
  return stale;
}

function main() {
  const violations = scanRepo();
  const stale = findStaleAllowlist();

  if (violations.length > 0) {
    console.error("");
    console.error("ERROR: plan 2026-09-08 M5 — markdown is rendered outside the one renderer.");
    console.error("");
    console.error("Render through the shared primitive (markdown-it, raw HTML off):");
    console.error('  import { renderMarkdown } from "@/lib/shared/markdown";');
    console.error('  import { MarkdownHtml } from "@/components/shared/MarkdownHtml";');
    console.error("Need a behaviour it lacks? Add an option to renderMarkdown().");
    console.error("");
    console.error("Offending imports:");
    for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.text}`);
    console.error("");
    process.exit(1);
  }

  if (stale.length > 0) {
    console.error("");
    console.error("ERROR: plan 2026-09-08 M5 — the markdown-renderer allowlist is stale.");
    console.error("These files no longer import a markdown library;");
    console.error("delete them from ALLOWLIST in scripts/check-no-local-markdown-renderer.mjs:");
    for (const f of stale) console.error(`  ${f}`);
    console.error("");
    process.exit(1);
  }

  console.log(`✓ One markdown renderer (${CANONICAL}); ${ALLOWLIST.size} allowlisted exceptions.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
