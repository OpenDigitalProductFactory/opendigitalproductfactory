#!/usr/bin/env node
/**
 * Plan 2026-09-08 move M3, phase 1: CI ratchet that keeps the durable-job
 * engine behind one facade.
 *
 * Every job function and every event send site imports `@/lib/jobs`
 * (apps/web/lib/jobs/). That directory holds the contract and the only engine
 * adapter; it is the one place allowed to reach the engine itself. The owned
 * Postgres engine (the 2026-09-25 durable job engine spec, §6 step 2) replaces
 * the adapter there, and the swap stays a one-directory change only while
 * nothing else imports the engine.
 *
 * This guard flags any source file outside the facade that imports, re-exports,
 * requires or mocks:
 *   - the `inngest` package, a subpath of it, or an `@inngest/*` package;
 *   - the retired client module (`.../inngest-client`);
 *   - the adapter module itself (`.../jobs/inngest-adapter`), which bypasses
 *     the facade's type narrowing.
 *
 * ALLOWLIST is the closed migration backlog. It starts empty: every import
 * moved in the same change. Do NOT add entries — import `@/lib/jobs`.
 *
 * Scope: apps/** and packages/** source (.ts .tsx .mts .cts .js .jsx .mjs
 * .cjs), tests included, build output and node_modules excluded.
 *
 * Run: node scripts/check-no-direct-job-engine-import.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The facade and its adapter: the one sanctioned home for engine imports.
export const FACADE_DIR = "apps/web/lib/jobs/";

// Closed migration backlog. Do NOT add entries — import `@/lib/jobs`.
export const ALLOWLIST = new Set([]);

export const SCAN_ROOTS = ["apps", "packages"];

const SOURCE_EXTENSIONS = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", "coverage", ".turbo", "out"]);

// A module specifier in any position that loads or mocks a module.
const SPECIFIER_PATTERNS = [
  /\b(?:import|export)\s[^;]*?\bfrom\s*["']([^"']+)["']/g,
  /\bimport\s*["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\b(?:vi|jest)\.(?:mock|doMock|unmock|importActual|importMock)\s*(?:<[^>]*>)?\(\s*["']([^"']+)["']/g,
];

/** True when `specifier` reaches the engine rather than the facade. */
export function isEngineSpecifier(specifier) {
  return specifier === "inngest"
    || specifier.startsWith("inngest/")
    || specifier.startsWith("@inngest/")
    || /(?:^|\/)inngest-client$/.test(specifier)
    || /(?:^|\/)jobs\/inngest-adapter$/.test(specifier);
}

function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith("*") || t.startsWith("//") || t.startsWith("/*");
}

/** 1-based line numbers, specifiers and text of every engine import in `body`. */
export function findEngineImports(body) {
  const hits = [];
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isCommentLine(line)) continue;
    for (const pattern of SPECIFIER_PATTERNS) {
      pattern.lastIndex = 0;
      for (const match of line.matchAll(pattern)) {
        const seen = hits.some((h) => h.line === i + 1 && h.specifier === match[1]);
        if (isEngineSpecifier(match[1]) && !seen) {
          hits.push({ line: i + 1, specifier: match[1], text: line.trim() });
        }
      }
    }
  }
  // A multi-line `import {\n a,\n b\n} from "inngest"` ends on a line that
  // starts with `}`; catch the `from` clause on its own line too.
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*\}\s*from\s*["']([^"']+)["']/.exec(lines[i]);
    if (m && isEngineSpecifier(m[1]) && !hits.some((h) => h.line === i + 1)) {
      hits.push({ line: i + 1, specifier: m[1], text: lines[i].trim() });
    }
  }
  return hits.sort((a, b) => a.line - b.line);
}

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      yield* walk(full);
    } else if (s.isFile() && SOURCE_EXTENSIONS.test(entry) && !entry.endsWith(".d.ts")) {
      yield full;
    }
  }
}

/** Scan the source roots under `root`; return engine imports outside the facade. */
export function scanRepo(root = REPO_ROOT) {
  const violations = [];
  for (const scanRoot of SCAN_ROOTS) {
    for (const file of walk(join(root, scanRoot))) {
      const rel = relative(root, file).replace(/\\/g, "/");
      if (rel.startsWith(FACADE_DIR) || ALLOWLIST.has(rel)) continue;
      for (const hit of findEngineImports(readFileSync(file, "utf8"))) {
        violations.push({ file: rel, ...hit });
      }
    }
  }
  return violations;
}

/** Allowlisted files that no longer import the engine — stale entries to prune. */
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
    if (findEngineImports(body).length === 0) stale.push(rel);
  }
  return stale;
}

function main() {
  const violations = scanRepo();
  const stale = findStaleAllowlist();
  if (violations.length > 0) {
    console.error("\nERROR: a file outside the job facade imports the job engine directly.\n");
    console.error("Job functions and send sites use the facade:");
    console.error('  import { jobs } from "@/lib/jobs";');
    console.error('  import { cron } from "@/lib/jobs/triggers";\n');
    for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.text}`);
    console.error("");
    process.exit(1);
  }
  if (stale.length > 0) {
    console.error("\nERROR: stale ALLOWLIST entries in scripts/check-no-direct-job-engine-import.mjs:");
    for (const f of stale) console.error(`  ${f}`);
    console.error("");
    process.exit(1);
  }
  console.log(`✓ No job-engine imports outside ${FACADE_DIR}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
