#!/usr/bin/env node
/**
 * BI-C0CEB377 (EP-8DC217EB BET-14) — CI ratchet: no NEW `nanoid` import.
 *
 * The `nanoid` dependency was internalized behind an owned façade over Node
 * crypto (kernel-approved own-newid-facade, HIGH, margin 3.115):
 *
 *   import { newId } from "@/lib/shared/new-id";
 *
 * The dependency is dropped from apps/web/package.json. This guard freezes the
 * import count at ZERO: every one of the 38 former call sites was migrated, so
 * the ALLOWLIST is empty. Any NEW `from "nanoid"` (or `require("nanoid")`)
 * import fails CI, so fresh code uses the owned generator instead of
 * re-introducing the dropped dependency.
 *
 * Scope: apps/web, packages, services (source + tests). The owned façade in
 * lib/shared/new-id.ts is the sanctioned home; it does not import nanoid so it
 * is never flagged, but its own name mentions "nanoid" in comments — the
 * matcher only inspects import/require SPECIFIERS, not comments, so it is safe.
 *
 * Run: node scripts/check-no-nanoid-import.mjs
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

// Roots to scan (relative to repo root). Missing roots are skipped.
export const SCAN_ROOTS = ["apps/web", "packages", "services"];

// Files that imported `nanoid` at the BI-C0CEB377 baseline. EMPTY: every site
// was migrated to `@/lib/shared/new-id`. Do NOT add entries — new code must use
// the owned newId() façade, never re-declare the dropped dependency.
export const ALLOWLIST = new Set([]);

// The sanctioned owned home — never flagged (it does not import nanoid).
export const CANONICAL = "apps/web/lib/shared/new-id.ts";

// An ES import or CJS require whose SPECIFIER is exactly `nanoid` (bare module).
// Matches `from "nanoid"`, `from 'nanoid'`, `require("nanoid")`. Deliberately
// does NOT match `nanoid/...` subpaths (none exist) or comment text.
export const IMPORT_PATTERNS = [
  /\bfrom\s+["']nanoid["']/,
  /\brequire\(\s*["']nanoid["']\s*\)/,
  /\bimport\(\s*["']nanoid["']\s*\)/,
];

function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith("*") || t.startsWith("//") || t.startsWith("/*");
}

/** Return the 1-based line numbers + text of every nanoid import specifier. */
export function findImportLines(body) {
  const hits = [];
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isCommentLine(line)) continue;
    if (IMPORT_PATTERNS.some((p) => p.test(line))) {
      hits.push({ line: i + 1, text: line.trim() });
    }
  }
  return hits;
}

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    // An entry can vanish between readdirSync and statSync — a generator writing
    // into a scan root (prisma generate under packages/db/generated) is enough.
    // readdirSync and readFileSync in this file are already defensive; statSync
    // was not, so a vanished entry threw and killed the guard. The guard loop
    // then reported "found violations" with NO violation block printed, which is
    // indistinguishable from a real violation — a crash must never be able to
    // masquerade as a finding.
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      if (
        entry === "node_modules" ||
        entry === ".next" ||
        entry === "__snapshots__" ||
        entry === "dist"
      )
        continue;
      yield* walk(full);
    } else if (s.isFile()) {
      if (full.endsWith(".d.ts")) continue;
      if (
        !full.endsWith(".ts") &&
        !full.endsWith(".tsx") &&
        !full.endsWith(".js") &&
        !full.endsWith(".jsx") &&
        !full.endsWith(".mjs")
      )
        continue;
      yield full;
    }
  }
}

/** Scan the SCAN_ROOTS under `root`; return imports outside the allowlist. */
export function scanRepo(root = process.cwd()) {
  const violations = [];
  for (const scanRoot of SCAN_ROOTS) {
    const dir = join(root, scanRoot);
    if (!existsSync(dir)) continue;
    for (const file of walk(dir)) {
      const rel = relative(root, file).replace(/\\/g, "/");
      if (rel === CANONICAL || ALLOWLIST.has(rel)) continue;
      let body;
      try {
        body = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      for (const h of findImportLines(body)) {
        violations.push({ file: rel, ...h });
      }
    }
  }
  return violations;
}

/** Allowlisted files that no longer import nanoid — stale entries to prune. */
export function findStaleAllowlist(root = process.cwd()) {
  const stale = [];
  for (const rel of ALLOWLIST) {
    let body;
    try {
      body = readFileSync(join(root, rel), "utf8");
    } catch {
      stale.push(rel);
      continue;
    }
    if (findImportLines(body).length === 0) stale.push(rel);
  }
  return stale;
}

function main() {
  const violations = scanRepo();
  const stale = findStaleAllowlist();

  if (violations.length > 0) {
    console.error("");
    console.error("ERROR: BI-C0CEB377 — a NEW `nanoid` import was added.");
    console.error("");
    console.error("The nanoid dependency was internalized. Use the owned façade:");
    console.error('  import { newId } from "@/lib/shared/new-id";');
    console.error("");
    console.error("Offending imports:");
    for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.text}`);
    console.error("");
    process.exit(1);
  }

  if (stale.length > 0) {
    console.error("");
    console.error("ERROR: BI-C0CEB377 — the nanoid allowlist is stale.");
    console.error("These files no longer import nanoid; prune them from ALLOWLIST");
    console.error("in scripts/check-no-nanoid-import.mjs:");
    for (const f of stale) console.error(`  ${f}`);
    console.error("");
    process.exit(1);
  }

  console.log(
    `✓ No nanoid imports (dependency internalized behind @/lib/shared/new-id; ${ALLOWLIST.size} allowlisted).`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
