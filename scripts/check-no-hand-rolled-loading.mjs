#!/usr/bin/env node
/**
 * BI-BBA388A1 (EP-PLATFORM-CONSOLIDATION) — CI ratchet: no NEW hand-rolled
 * loading indicators.
 *
 * Async activity indication has one canonical home — the shared primitives in
 * apps/web/components/ui/ (Spinner, Skeleton, ProgressBar, InlineBusy). Before
 * they existed, ~30+ components hand-rolled `animate-spin` / `animate-pulse`
 * inline, inconsistently and without reduced-motion or a11y semantics. See
 * docs/platform-usability-standards.md ("Async Activity & Loading States").
 *
 * This is a RATCHET, not a mass-rewrite mandate (same shape as
 * check-no-raw-route-error + check-module-size): it freezes a per-file COUNT
 * baseline of raw `animate-spin` / `animate-pulse` occurrences OUTSIDE
 * components/ui/ and lets each file only SHRINK. A new file, or MORE hand-rolled
 * indicators in an already-listed file, fails; migrate to a ui/ primitive and
 * run --update to retighten.
 *
 * The baseline is line-oriented (`<path>\t<count>`, sorted) with git merge=union
 * (.gitattributes) so concurrent migration PRs never conflict; duplicate paths
 * from a union merge resolve to the MAX count.
 *
 * Scope: apps/web *.ts/*.tsx, EXCLUDING components/ui/ (the canonical home) and
 * tests. Semantic status dots (e.g. a pulsing health indicator) are state, not
 * loading — they legitimately live in the baseline until each owner decides.
 *
 *   node scripts/check-no-hand-rolled-loading.mjs            # check (CI)
 *   node scripts/check-no-hand-rolled-loading.mjs --update   # regenerate baseline
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIR = join(REPO_ROOT, "apps", "web");
const BASELINE_PATH = join(REPO_ROOT, "scripts", "hand-rolled-loading-baseline.txt");

// The canonical home for loading motion — never counted against the baseline.
const UI_HOME = join("apps", "web", "components", "ui").replace(/\\/g, "/");

// Raw Tailwind loading-animation utility classes used inline instead of a
// ui/ primitive. `animate-[spin|pulse]` covers the arbitrary-value form too.
export const HAND_ROLLED_RE = /\banimate-(?:spin|pulse|\[spin|\[pulse)/g;

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
      if (/\.(test|spec|stories)\.(ts|tsx)$/.test(full) || full.endsWith(".d.ts")) continue;
      if (!full.endsWith(".ts") && !full.endsWith(".tsx")) continue;
      yield full;
    }
  }
}

/** Per-file count of hand-rolled loading utilities under apps/web, minus ui/. */
export function scan() {
  const counts = {};
  for (const file of walk(SCAN_DIR)) {
    const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
    if (rel.startsWith(`${UI_HOME}/`)) continue;
    const body = readFileSync(file, "utf8");
    const n = (body.match(HAND_ROLLED_RE) ?? []).length;
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
    console.log(`Wrote hand-rolled-loading baseline: ${Object.keys(current).length} files, ${total} occurrences.`);
    return;
  }

  let baseline;
  try {
    baseline = parseBaseline(readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    console.error(`Missing ${relative(REPO_ROOT, BASELINE_PATH)} — run: node scripts/check-no-hand-rolled-loading.mjs --update`);
    process.exit(1);
  }

  const { grew, fresh } = diff(current, baseline);

  if (grew.length > 0 || fresh.length > 0) {
    console.error("");
    console.error("ERROR: BI-BBA388A1 — new hand-rolled `animate-spin` / `animate-pulse` loading indicator(s).");
    console.error("");
    console.error("Use a shared primitive from components/ui/ instead:");
    console.error('  import { Spinner } from "@/components/ui/Spinner";     // triggered / unknown duration');
    console.error('  import { Skeleton } from "@/components/ui/Skeleton";   // content filling a known layout');
    console.error('  import { ProgressBar } from "@/components/ui/ProgressBar"; // determinate work');
    console.error('  import { InlineBusy } from "@/components/ui/InlineBusy";   // a button pending state');
    console.error("  See docs/platform-usability-standards.md (Async Activity & Loading States).");
    console.error("");
    if (fresh.length) {
      console.error("New files with hand-rolled loading indicators:");
      for (const f of fresh) console.error(`  - ${f}`);
    }
    if (grew.length) {
      console.error("Files that GREW more hand-rolled indicators (baseline only allows shrinking):");
      for (const f of grew) console.error(`  - ${f}`);
    }
    console.error("");
    console.error("If you intentionally MIGRATED a surface (count dropped), run --update to retighten.");
    process.exit(1);
  }

  const total = Object.values(baseline).reduce((a, b) => a + b, 0);
  console.log(`✓ No new hand-rolled loading indicators (baseline: ${Object.keys(baseline).length} files, ${total} pending migration to a ui/ primitive).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
