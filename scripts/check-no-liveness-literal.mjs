#!/usr/bin/env node
/**
 * BI-B6157FB7 (EP-8DC217EB BET-10) — CI ratchet: no NEW `["working","active"]`
 * TaskRun liveness literal.
 *
 * The "loop is live and heartbeating" set was hand-copied to 6 source sites,
 * each re-deriving `status IN ("working","active")`. It now has one home:
 *
 *   import { TASK_LIVE_STATES, isLiveStatus } from "@/lib/tak/task-states";
 *
 * This guard freezes the copy count. Files that ALREADY inline the literal at
 * the baseline are in ALLOWLIST (a migration backlog — the queue/ Inngest
 * watchdog SQL is deferred to the reaper-framework phase, per the build-it-once
 * hot-zone rule). A NEW inline `["working", "active"]` array-literal outside
 * the allowlist fails CI.
 *
 * Scope: apps/web (source only, tests excluded). task-states.ts (the canonical
 * home) is skipped by path.
 *
 * Run: node scripts/check-no-liveness-literal.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

export const CANONICAL = "apps/web/lib/tak/task-states.ts";

// Empty at the BET-10 phase-1 baseline: all 5 JS array-literal sites
// (heartbeat, inert-build-reaper, quiescence ×3) were migrated to
// TASK_LIVE_STATES in this PR. The queue/ Inngest watchdog expresses the same
// set as raw SQL `IN ('working','active')` (single-quoted, not a JS array), and
// deliberation-run/brand-extract write the single status `"active"` — none
// match this guard's JS-array-literal pattern, so they need no allowlist entry;
// they migrate onto TASK_LIVE_STATES / markTaskRunWorking with the
// reaper-framework phase (queue/ is an Inside-Out hot-zone, coordinated).
export const ALLOWLIST = new Set([]);

// An inline `["working", "active"]` (or reversed) string-array literal.
export const LITERAL_PATTERNS = [
  /\[\s*"working"\s*,\s*"active"\s*\]/,
  /\[\s*'working'\s*,\s*'active'\s*\]/,
  /\[\s*"active"\s*,\s*"working"\s*\]/,
];

function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith("*") || t.startsWith("//") || t.startsWith("/*");
}

export function findLiteralLines(body) {
  const hits = [];
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (isCommentLine(lines[i])) continue;
    if (LITERAL_PATTERNS.some((p) => p.test(lines[i]))) {
      hits.push({ line: i + 1, text: lines[i].trim() });
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
    const s = statSync(full);
    if (s.isDirectory()) {
      if (entry === "node_modules" || entry === ".next" || entry === "__snapshots__" || entry === "dist") continue;
      yield* walk(full);
    } else if (s.isFile()) {
      if (full.endsWith(".test.ts") || full.endsWith(".test.tsx") || full.endsWith(".d.ts")) continue;
      if (!full.endsWith(".ts") && !full.endsWith(".tsx")) continue;
      yield full;
    }
  }
}

export function scanRepo(root = process.cwd()) {
  const violations = [];
  for (const file of walk(join(root, "apps", "web"))) {
    const rel = relative(root, file).replace(/\\/g, "/");
    if (rel === CANONICAL || ALLOWLIST.has(rel)) continue;
    let body;
    try {
      body = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const h of findLiteralLines(body)) violations.push({ file: rel, ...h });
  }
  return violations;
}

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
    if (findLiteralLines(body).length === 0) stale.push(rel);
  }
  return stale;
}

function main() {
  const violations = scanRepo();
  const stale = findStaleAllowlist();

  if (violations.length > 0) {
    console.error("");
    console.error('ERROR: BI-B6157FB7 — a NEW ["working","active"] liveness literal was added.');
    console.error("");
    console.error("Use the one shared set instead of inlining the pair:");
    console.error('  import { TASK_LIVE_STATES, isLiveStatus } from "@/lib/tak/task-states";');
    console.error("  where: { status: { in: [...TASK_LIVE_STATES] } }");
    console.error("");
    for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.text}`);
    console.error("");
    process.exit(1);
  }

  if (stale.length > 0) {
    console.error("");
    console.error("ERROR: BI-B6157FB7 — the liveness-literal allowlist is stale.");
    console.error("These files no longer inline the literal; delete them from ALLOWLIST in");
    console.error("scripts/check-no-liveness-literal.mjs:");
    for (const f of stale) console.error(`  ${f}`);
    console.error("");
    process.exit(1);
  }

  console.log(
    `✓ No new ["working","active"] liveness literals (${ALLOWLIST.size} pre-existing, deferred to the reaper-framework phase).`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
