#!/usr/bin/env node
/**
 * BI-B6157FB7 (EP-8DC217EB BET-10) — CI ratchet: no NEW hardcoded liveness
 * literal.
 *
 * The "loop is alive" status set `["working","active"]` (and its raw-SQL twin
 * `IN ('working','active')`) was hand-inlined into six liveness sites — the
 * heartbeat filter, the stall-watchdog SQL, the quiescence flip + dead-loop
 * reap, and the inert-build reaper. It now has one canonical home:
 *
 *   import { TASK_LIVE_STATES, isLiveStatus } from "@/lib/tak/task-states";
 *
 * This guard freezes the copy count. Every site was migrated, so the ALLOWLIST
 * is EMPTY. Any NEW inline `["working","active"]` / `IN ('working','active')`
 * outside the canonical homes fails CI, so fresh code imports the constant (or
 * builds the SQL IN-list from it via Prisma.join) instead of re-inlining.
 *
 * Scope: apps/web/lib (source only, tests excluded). The canonical homes
 * (lib/tak/task-states.ts — the constant; lib/shared/staleness.ts — the
 * companion staleness helpers) are skipped by path.
 *
 * NOTE — this is a DUPLICATION ratchet, not a correctness gate. It matches the
 * idiom of scripts/check-no-local-isrecord.mjs exactly (frozen allowlist,
 * canonical skip set, self-tested flag+clean directions).
 *
 * Run: node scripts/check-no-local-liveness-literal.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

// The sanctioned homes for the liveness set — never flagged.
export const CANONICAL = new Set([
  "apps/web/lib/tak/task-states.ts",
  "apps/web/lib/shared/staleness.ts",
]);

// Files that inlined the liveness literal at the BI-B6157FB7 baseline. Every
// site was migrated in the same PR, so this is EMPTY. Do NOT add entries — new
// code must import TASK_LIVE_STATES (or build the SQL IN-list from it).
export const ALLOWLIST = new Set([]);

// An array literal containing exactly the two liveness values, in either
// order: ["working","active"] / ['active','working'] / { in: ["working",
// "active"] }. The two captured strings must be the {working, active} pair.
const ARRAY_PATTERN = /\[\s*["'](working|active)["']\s*,\s*["'](working|active)["']\s*\]/gi;
// The raw-SQL twin: IN ('working','active') (case-insensitive on IN).
const SQL_PATTERN = /\bin\s*\(\s*'(working|active)'\s*,\s*'(working|active)'\s*\)/gi;

function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith("*") || t.startsWith("//") || t.startsWith("/*");
}

/** True when the two captured tokens are the distinct {working, active} pair. */
function isLivenessPair(a, b) {
  const lo = new Set([a.toLowerCase(), b.toLowerCase()]);
  return lo.size === 2 && lo.has("working") && lo.has("active");
}

/** Return the 1-based line numbers + text of every inlined liveness literal. */
export function findLivenessLiterals(body) {
  const hits = [];
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isCommentLine(line)) continue;
    for (const re of [ARRAY_PATTERN, SQL_PATTERN]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line)) !== null) {
        if (isLivenessPair(m[1], m[2])) {
          hits.push({ line: i + 1, text: line.trim() });
          break;
        }
      }
    }
  }
  return hits;
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
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

/** Scan apps/web/lib under `root`; return literals outside the allowlist. */
export function scanRepo(root = process.cwd()) {
  const scanDir = join(root, "apps", "web", "lib");
  const violations = [];
  for (const file of walk(scanDir)) {
    const rel = relative(root, file).replace(/\\/g, "/");
    if (CANONICAL.has(rel) || ALLOWLIST.has(rel)) continue;
    let body;
    try {
      body = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const h of findLivenessLiterals(body)) {
      violations.push({ file: rel, ...h });
    }
  }
  return violations;
}

/** Allowlisted files that no longer inline the literal — stale entries to prune. */
export function findStaleAllowlist(root = process.cwd()) {
  const stale = [];
  for (const rel of ALLOWLIST) {
    let body;
    try {
      body = readFileSync(join(root, rel), "utf8");
    } catch {
      stale.push(rel); // file gone
      continue;
    }
    if (findLivenessLiterals(body).length === 0) stale.push(rel);
  }
  return stale;
}

function main() {
  const violations = scanRepo();
  const stale = findStaleAllowlist();

  if (violations.length > 0) {
    console.error("");
    console.error("ERROR: BI-B6157FB7 — a NEW hardcoded liveness literal was added.");
    console.error("");
    console.error("There is one canonical live-status set. Import it instead of inlining:");
    console.error('  import { TASK_LIVE_STATES, isLiveStatus } from "@/lib/tak/task-states";');
    console.error("For raw SQL, build the IN-list from it: `IN (${Prisma.join([...TASK_LIVE_STATES])})`.");
    console.error("");
    console.error("Offending literals:");
    for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.text}`);
    console.error("");
    process.exit(1);
  }

  if (stale.length > 0) {
    console.error("");
    console.error("ERROR: BI-B6157FB7 — the liveness-literal allowlist is stale.");
    console.error("These files no longer inline the literal (migrated or removed);");
    console.error("delete them from ALLOWLIST in scripts/check-no-local-liveness-literal.mjs:");
    for (const f of stale) console.error(`  ${f}`);
    console.error("");
    process.exit(1);
  }

  console.log(
    `✓ No new hardcoded liveness literals (${ALLOWLIST.size} pre-existing copies pending migration to @/lib/tak/task-states).`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
