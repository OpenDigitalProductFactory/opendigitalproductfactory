#!/usr/bin/env node
/**
 * BI-81EE4A46 (EP-8DC217EB, plan §6) — CI ratchet: no NEW raw route error JSON.
 *
 * API routes under apps/web/app return errors 292 different ways as inline
 * `NextResponse.json({ error: … }, { status })` literals, so the error envelope
 * shape (field name, whether a code/details is present, the status coupling)
 * drifts route by route. There is one canonical home:
 *
 *   import { apiErrorResponse } from "@/lib/api/error";
 *   return apiErrorResponse("NOT_FOUND", "Epic not found", 404);
 *
 * This is a RATCHET, not a mass-rewrite mandate (same shape as
 * check-style-drift + check-module-size): it freezes a per-file COUNT baseline
 * of raw `NextResponse.json({ error … })` occurrences and lets each file only
 * SHRINK. A new file, or MORE raw errors in an already-listed file, fails CI;
 * migrate a route onto apiErrorResponse and run --update to retighten.
 *
 * The baseline is line-oriented (`<path>\t<count>`, sorted) with git
 * merge=union (.gitattributes) so concurrent migration PRs never conflict
 * (BI-3B0AD9CF); duplicate paths from a union merge resolve to the MAX count.
 *
 * Scope: apps/web/app (route handlers), *.ts, tests excluded.
 *
 *   node scripts/check-no-raw-route-error.mjs            # check (CI)
 *   node scripts/check-no-raw-route-error.mjs --update   # regenerate baseline
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIR = join(REPO_ROOT, "apps", "web", "app");
const BASELINE_PATH = join(REPO_ROOT, "scripts", "route-error-baseline.txt");

// Raw `NextResponse.json({ error …` — the inline error-envelope anti-pattern.
export const RAW_ERROR_RE = /NextResponse\.json\(\s*\{\s*error/g;

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
      if (full.endsWith(".test.ts") || full.endsWith(".d.ts")) continue;
      if (!full.endsWith(".ts")) continue;
      yield full;
    }
  }
}

/** Per-file count of raw route-error literals under apps/web/app. */
export function scan() {
  const counts = {};
  for (const file of walk(SCAN_DIR)) {
    const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
    const body = readFileSync(file, "utf8");
    const n = (body.match(RAW_ERROR_RE) ?? []).length;
    if (n > 0) counts[rel] = n;
  }
  return counts;
}

function serialize(counts) {
  return `${Object.keys(counts)
    .sort()
    .map((k) => `${k}\t${counts[k]}`)
    .join("\n")}\n`;
}

/** Parse `<path>\t<count>` lines; union-merge duplicates resolve to MAX. */
export function parseBaseline(text) {
  const counts = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(.+?)\s+(\d+)$/);
    if (!m) continue;
    const [, file, n] = m;
    const count = Number(n);
    if (!(file in counts) || count > counts[file]) counts[file] = count;
  }
  return counts;
}

export function diff(current, baseline) {
  const grew = [];
  const fresh = [];
  for (const [file, n] of Object.entries(current)) {
    if (file in baseline) {
      if (n > baseline[file]) grew.push(`${file} (${baseline[file]} -> ${n})`);
    } else {
      fresh.push(`${file} (${n})`);
    }
  }
  return { grew, fresh };
}

function main() {
  const current = scan();

  if (process.argv.includes("--update")) {
    writeFileSync(BASELINE_PATH, serialize(current));
    const total = Object.values(current).reduce((a, b) => a + b, 0);
    console.log(`Wrote route-error baseline: ${Object.keys(current).length} files, ${total} raw errors.`);
    return;
  }

  let baseline;
  try {
    baseline = parseBaseline(readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    console.error(`Missing ${relative(REPO_ROOT, BASELINE_PATH)} — run: node scripts/check-no-raw-route-error.mjs --update`);
    process.exit(1);
  }

  const { grew, fresh } = diff(current, baseline);

  if (grew.length > 0 || fresh.length > 0) {
    console.error("");
    console.error("ERROR: BI-81EE4A46 — new raw `NextResponse.json({ error … })` route error(s).");
    console.error("");
    console.error("Return the canonical envelope instead:");
    console.error('  import { apiErrorResponse } from "@/lib/api/error";');
    console.error('  return apiErrorResponse("NOT_FOUND", "…", 404);');
    console.error("");
    if (fresh.length) {
      console.error("New files with raw route errors:");
      for (const f of fresh) console.error(`  - ${f}`);
    }
    if (grew.length) {
      console.error("Files that GREW more raw route errors (baseline only allows shrinking):");
      for (const f of grew) console.error(`  - ${f}`);
    }
    console.error("");
    console.error("If you intentionally MIGRATED a route (count dropped), run --update to retighten.");
    process.exit(1);
  }

  const total = Object.values(baseline).reduce((a, b) => a + b, 0);
  console.log(`✓ No new raw route errors (baseline: ${Object.keys(baseline).length} files, ${total} pending migration to apiErrorResponse).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
