#!/usr/bin/env node
// Style drift guard — BI-ARCH-UI-PRIMS.
//
// DPF theming is token-based (--dpf-* CSS custom properties + the report-kit
// status palette) so light/dark/branding all work (AGENTS.md §12). Hardcoded hex
// colors break that. This guard is a RATCHET: it fails a PR that adds a NEW
// hardcoded hex color (a new file with hex, or more hex in an already-touched
// file) — without forcing a blind mass-rewrite of the ~170 files that predate
// it (spec §6.6: "migrate as touched"). Migrate a surface, then drop it from the
// baseline and the ratchet tightens.
//
// Approved homes for raw color values (token/chart-theme files) are skipped.
// A genuine non-color `#abc`-shaped literal can be marked with a trailing
// `// style-drift-allow` comment on the same line.
//
//   node scripts/check-style-drift.mjs            # check (CI)
//   node scripts/check-style-drift.mjs --update   # regenerate the baseline

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = join(REPO_ROOT, "apps", "web");
const SCAN_DIRS = ["app", "components", "lib", "hooks"].map((d) => join(WEB, d));
const BASELINE_PATH = join(REPO_ROOT, "scripts", "style-drift-baseline.json");

// Token / chart-theme files legitimately carry raw color values.
const APPROVED = [
  "apps/web/components/ui/report-kit/",
  "apps/web/components/ui/report-kit/chartTheme",
];
const APPROVED_NAME_RE = /(chartTheme|chart-theme|chart-colors|color-tokens)\./;

// Color-shaped hex literals: #rgb, #rgba, #rrggbb, #rrggbbaa.
const HEX_RE = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{4}\b|#[0-9a-fA-F]{3}\b/g;
const ALLOW_LINE = "style-drift-allow";

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
    else if (/\.(ts|tsx|mts|cts)$/.test(entry) && !/\.(test|spec)\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

function isApproved(rel) {
  return APPROVED.some((p) => rel.startsWith(p)) || APPROVED_NAME_RE.test(rel);
}

/** Count hardcoded hex colors per file (skipping `// style-drift-allow` lines). */
function scan() {
  const counts = {};
  for (const dir of SCAN_DIRS) {
    for (const file of listSourceFiles(dir)) {
      const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
      if (isApproved(rel)) continue;
      let count = 0;
      for (const line of readFileSync(file, "utf8").split("\n")) {
        if (line.includes(ALLOW_LINE)) continue;
        const matches = line.match(HEX_RE);
        if (matches) count += matches.length;
      }
      if (count > 0) counts[rel] = count;
    }
  }
  return counts;
}

const counts = scan();

if (process.argv.includes("--update")) {
  const sorted = Object.fromEntries(Object.keys(counts).sort().map((k) => [k, counts[k]]));
  writeFileSync(BASELINE_PATH, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`Wrote style-drift baseline: ${Object.keys(sorted).length} files with hardcoded hex.`);
  process.exit(0);
}

let baseline = {};
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
} catch {
  console.error(`Missing baseline ${relative(REPO_ROOT, BASELINE_PATH)} — run: node scripts/check-style-drift.mjs --update`);
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
  console.error("Style drift — new hardcoded hex colors. Use --dpf-* tokens or the report-kit");
  console.error("status palette (AGENTS.md §12). For a genuine non-color literal, add a trailing");
  console.error("`// style-drift-allow` comment.\n");
  if (newFiles.length) {
    console.error("New files with hardcoded hex:");
    for (const f of newFiles) console.error(`  - ${f}`);
  }
  if (increased.length) {
    console.error("More hardcoded hex than the baseline:");
    for (const f of increased) console.error(`  - ${f}`);
  }
  console.error("\nIf you intentionally migrated a file to fewer hex, run --update to retighten the baseline.");
  process.exit(1);
}

const total = Object.values(baseline).reduce((a, b) => a + b, 0);
console.log(
  `Style drift OK — no new hardcoded hex. Baseline: ${Object.keys(baseline).length} files / ${total} known hex (migrate as touched).`,
);
