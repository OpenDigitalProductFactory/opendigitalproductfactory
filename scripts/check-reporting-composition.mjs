#!/usr/bin/env node
// Reporting-composition guard — EP-829D997C / BI-801758D1.
//
// The kernel principle `compose-report-kit-for-reporting-ux` (AGENTS.md §12) says
// tabular/reporting data-display UI composes the shared report-kit — chiefly the
// `DataTable` primitive (sortable, paginated, empty/loading states, token-styled)
// — instead of hand-rolled raw `<table>` markup. At the time this guard landed ~87
// component/page files still hand-rolled a raw `<table>`; DataTable was adopted by
// only ~16.
//
// This is a RATCHET, not a mass-rewrite mandate (same shape as check-style-drift):
// it fails a PR that adds a NEW raw `<table>` (a new file, or MORE `<table>`s in an
// already-touched file) — without forcing the ~87 legacy surfaces to migrate at
// once. Migrate a surface to DataTable, then run --update and the ratchet tightens.
//
// report-kit itself (DataTable renders the one legitimate `<table>`) is skipped. A
// genuinely necessary raw table (email HTML, print layout, a shape DataTable can't
// express) can be marked with a trailing `// reporting-composition-allow` comment
// on the same line.
//
//   node scripts/check-reporting-composition.mjs            # check (CI)
//   node scripts/check-reporting-composition.mjs --update   # regenerate the baseline

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, relative } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = join(REPO_ROOT, "apps", "web");
const SCAN_DIRS = ["app", "components"].map((d) => join(WEB, d));
const BASELINE_PATH = join(REPO_ROOT, "scripts", "reporting-composition-baseline.json");

// report-kit owns the one legitimate raw <table> (DataTable's own render).
const APPROVED = ["apps/web/components/ui/report-kit/"];

// A JSX opening <table> tag: `<table` followed by whitespace, `>`, `/`, or end
// of line. End-of-line matters because pretty-printed JSX often puts attributes
// on the next line (`<table\n  style=...>`), which previously slipped past the
// ratchet (BI-F7792FC1).
const TABLE_RE = /<table(?:[\s/>]|$)/g;
const ALLOW_LINE = "reporting-composition-allow";

/** Count raw `<table>` opening tags on a single line (0 if the line opts out). */
export function rawTableMatches(line) {
  if (line.includes(ALLOW_LINE)) return [];
  return line.match(TABLE_RE) || [];
}

function listSourceFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".next" || entry === "dist" || entry === ".turbo") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listSourceFiles(full));
    // JSX-bearing files only; tests may legitimately render a raw <table>.
    else if (/\.tsx$/.test(entry) && !/\.(test|spec)\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

function isApproved(rel) {
  return APPROVED.some((p) => rel.startsWith(p));
}

/** Count raw `<table>` tags per file (skipping `// reporting-composition-allow` lines). */
export function scan() {
  const counts = {};
  for (const dir of SCAN_DIRS) {
    for (const file of listSourceFiles(dir)) {
      const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
      if (isApproved(rel)) continue;
      let count = 0;
      for (const line of readFileSync(file, "utf8").split("\n")) {
        count += rawTableMatches(line).length;
      }
      if (count > 0) counts[rel] = count;
    }
  }
  return counts;
}

function main() {
  const counts = scan();

  if (process.argv.includes("--update")) {
    const sorted = Object.fromEntries(Object.keys(counts).sort().map((k) => [k, counts[k]]));
    writeFileSync(BASELINE_PATH, `${JSON.stringify(sorted, null, 2)}\n`);
    console.log(`Wrote reporting-composition baseline: ${Object.keys(sorted).length} files with raw <table>.`);
    process.exit(0);
  }

  let baseline = {};
  try {
    baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    console.error(`Missing baseline ${relative(REPO_ROOT, BASELINE_PATH)} — run: node scripts/check-reporting-composition.mjs --update`);
    process.exit(1);
  }

  const newFiles = [];
  const increased = [];
  for (const [file, count] of Object.entries(counts)) {
    const prior = baseline[file] ?? 0;
    if (prior === 0) newFiles.push(`${file} (+${count})`);
    else if (count > prior) increased.push(`${file} (${prior} -> ${count})`);
  }

  if (newFiles.length > 0 || increased.length > 0) {
    console.error("Reporting-composition drift — new raw <table> markup. Compose the shared");
    console.error("report-kit DataTable (sortable, paginated, empty/loading, token-styled) instead");
    console.error("(AGENTS.md §12, kernel principle compose-report-kit-for-reporting-ux). For a");
    console.error("genuinely necessary raw table, add a trailing `// reporting-composition-allow`.\n");
    if (newFiles.length) {
      console.error("New files with raw <table>:");
      for (const f of newFiles) console.error(`  - ${f}`);
    }
    if (increased.length) {
      console.error("More raw <table> than the baseline:");
      for (const f of increased) console.error(`  - ${f}`);
    }
    console.error("\nIf you intentionally migrated a file to DataTable, run --update to retighten the baseline.");
    process.exit(1);
  }

  const total = Object.values(baseline).reduce((a, b) => a + b, 0);
  console.log(
    `Reporting-composition OK — no new raw <table>. Baseline: ${Object.keys(baseline).length} files / ${total} known tables (migrate to DataTable as touched).`,
  );
}

// Run main() only when invoked directly, not when imported by the test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
