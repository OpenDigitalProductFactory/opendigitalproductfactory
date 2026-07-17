#!/usr/bin/env node
// Module-size ratchet — BI-OPT-RATCHETS.
//
// No size guard existed before this one, which is how a single source module
// (apps/web/lib/mcp-tools.ts) grew past 15k LOC unnoticed. This guard is a
// RATCHET in the same shape as scripts/check-style-drift.mjs and
// check-no-bare-working-write.mjs: it freezes a baseline of the files that are
// already large and lets them only SHRINK, while holding NEW files to a small
// ceiling. It does NOT force a blind split of the files that predate it — those
// come down one refactor at a time, and each shrink retightens the baseline.
//
// Rules:
//   - A NEW file (one not in the baseline) must be <= 800 LOC (soft ceiling),
//     and is hard-capped at 1000 LOC — a new file over 1000 always fails.
//   - A BASELINED file may only shrink: it fails if its current LOC exceeds the
//     value recorded in the baseline. Shrinking it below its recorded value is
//     fine; re-run with --update to lock in the smaller number.
//
// Scope: tracked .ts/.tsx under apps/, packages/, scripts/. Generated and
// seed/corpus files are excluded (they are data, not modules a human edits).
//
//   node scripts/check-module-size.mjs            # check (CI)
//   node scripts/check-module-size.mjs --update   # regenerate the baseline

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import {
  MODULE_SIZE_HARD_CAP as HARD_CAP,
  MODULE_SIZE_SOFT_CEILING as SOFT_CEILING,
  scanModuleSizesSync,
} from "./lib/module-size-scope.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// Line-oriented `<path>\t<loc>` baseline, merged with git's built-in
// `merge=union` driver (.gitattributes) so concurrent PRs that each re-baseline
// never conflict (BI-3B0AD9CF). A union merge can leave duplicate paths; the
// parser resolves a duplicate to the LARGEST recorded LOC (never falsely red
// after a merge — the next --update rewrites sorted + deduped and retightens).
const BASELINE_PATH = join(REPO_ROOT, "scripts", "module-size-baseline.txt");

// New files must stay under this; existing large files are carried in the
// baseline and ratcheted down. Hard cap applies only to NEW files.
const sizes = scanModuleSizesSync({ repoRoot: REPO_ROOT });

function serializeBaseline(baseline) {
  const lines = Object.keys(baseline)
    .sort()
    .map((k) => `${k}\t${baseline[k]}`);
  return `${lines.join("\n")}\n`;
}

/** Parse `<path>\t<loc>` lines; duplicates (from a union merge) resolve to max. */
function parseBaseline(text) {
  const baseline = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(.+?)\s+(\d+)$/);
    if (!m) continue;
    const [, file, locStr] = m;
    const loc = Number(locStr);
    if (!(file in baseline) || loc > baseline[file]) baseline[file] = loc;
  }
  return baseline;
}

if (process.argv.includes("--update")) {
  // Snapshot every file currently OVER the soft ceiling. Files at or under the
  // ceiling are not baselined — they are simply held to the ceiling as "new".
  const over = Object.keys(sizes)
    .filter((k) => sizes[k] > SOFT_CEILING)
    .sort();
  const baseline = Object.fromEntries(over.map((k) => [k, sizes[k]]));
  writeFileSync(BASELINE_PATH, serializeBaseline(baseline));
  console.log(
    `Wrote module-size baseline: ${over.length} files over ${SOFT_CEILING} LOC (ratchet-down set).`,
  );
  process.exit(0);
}

let baseline = {};
try {
  baseline = parseBaseline(readFileSync(BASELINE_PATH, "utf8"));
} catch {
  console.error(
    `Missing baseline ${relative(REPO_ROOT, BASELINE_PATH)} — run: node scripts/check-module-size.mjs --update`,
  );
  process.exit(1);
}

const grew = []; // baselined file now larger than its recorded LOC
const newOverSoft = []; // new file over the soft ceiling (<= hard cap)
const newOverHard = []; // new file over the hard cap

for (const [file, loc] of Object.entries(sizes)) {
  if (file in baseline) {
    if (loc > baseline[file]) grew.push(`${file} (${baseline[file]} -> ${loc})`);
  } else if (loc > HARD_CAP) {
    newOverHard.push(`${file} (${loc} LOC, hard cap ${HARD_CAP})`);
  } else if (loc > SOFT_CEILING) {
    newOverSoft.push(`${file} (${loc} LOC, ceiling ${SOFT_CEILING})`);
  }
}

if (grew.length > 0 || newOverSoft.length > 0 || newOverHard.length > 0) {
  console.error("Module-size ratchet failed (BI-OPT-RATCHETS).\n");
  if (newOverHard.length) {
    console.error(`New files over the ${HARD_CAP}-LOC hard cap — split before merge:`);
    for (const f of newOverHard) console.error(`  - ${f}`);
    console.error("");
  }
  if (newOverSoft.length) {
    console.error(
      `New files over the ${SOFT_CEILING}-LOC ceiling — keep modules focused (split, or`,
    );
    console.error("extract a submodule):");
    for (const f of newOverSoft) console.error(`  - ${f}`);
    console.error("");
  }
  if (grew.length) {
    console.error("Baselined files that GREW — the baseline only allows shrinking:");
    for (const f of grew) console.error(`  - ${f}`);
    console.error("");
    console.error("Reduce the file, or if the growth is unavoidable and intentional, justify it");
    console.error("and run `node scripts/check-module-size.mjs --update` to re-baseline.");
    console.error("");
  }
  console.error(
    "If you intentionally SHRANK a baselined file, run --update to retighten the baseline.",
  );
  process.exit(1);
}

const baselinedTotal = Object.keys(baseline).length;
console.log(
  `Module-size OK — no new oversized files, no baselined file grew. ` +
    `Baseline: ${baselinedTotal} files over ${SOFT_CEILING} LOC (ratchet down as refactored).`,
);
