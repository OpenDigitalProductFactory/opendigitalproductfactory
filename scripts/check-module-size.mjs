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
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, relative } from "node:path";
import {
  MODULE_SIZE_HARD_CAP as HARD_CAP,
  MODULE_SIZE_SOFT_CEILING as SOFT_CEILING,
  scanModuleSizesSync,
} from "./lib/module-size-scope.mjs";
import { formatTxtBudgetHeader, parseTxtBudgetHeader } from "./lib/baseline-budget.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// Line-oriented `<path>\t<loc>` baseline, merged with git's built-in
// `merge=union` driver (.gitattributes) so concurrent PRs that each re-baseline
// never conflict (BI-3B0AD9CF). A union merge can leave duplicate paths;
// parseBaseline keeps the SMALLER LOC (never loosens a size ceiling) and
// check mode continues; --update rewrites a clean one-line-per-path file
// (BI-24115B65). Hard-refusing duplicates defeated the union driver: green
// merge, then red guard on every rebase.
const BASELINE_PATH = join(REPO_ROOT, "scripts", "module-size-baseline.txt");

// Owned-expiring-budget header (BI-3F17B16B): the baseline carries `# owner:`
// and `# expiry:` comment lines; scripts/check-no-expired-baseline-budgets.mjs
// enforces presence + freshness. --update preserves the existing header.
const DEFAULT_BUDGET = Object.freeze({ owner: "platform-architecture", expiry: "2026-11-16" });
const BUDGET_NOTE_LINES = Object.freeze([
  "Module-size ratchet baseline (BI-OPT-RATCHETS). Shrink-only: files leave by",
  "being split/refactored under the ceiling, never by expanding the baseline.",
  "Regenerate with: node scripts/check-module-size.mjs --update",
]);

function serializeBaseline(baseline, budget = DEFAULT_BUDGET) {
  const header = formatTxtBudgetHeader({ ...budget, noteLines: BUDGET_NOTE_LINES });
  const lines = Object.keys(baseline)
    .sort()
    .map((k) => `${k}\t${baseline[k]}`);
  return `${header}${lines.join("\n")}\n`;
}

/**
 * Report paths that appear more than once (union-merge artifact).
 * Diagnostic only — check mode tolerates them via parseBaseline min-wins.
 */
export function findDuplicateBaselinePaths(text) {
  const seen = new Map();
  const dups = new Set();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(.+?)\s+(\d+)$/);
    if (!m) continue;
    const file = m[1];
    if (seen.has(file)) dups.add(file);
    else seen.set(file, true);
  }
  return [...dups].sort();
}

/**
 * Parse `<path>\t<loc>` lines.
 * Union merges (BI-3B0AD9CF) can leave the same path on multiple lines.
 * Keep the SMALLER LOC so a stale/larger sibling never loosens the ratchet
 * (size ceiling semantics — min-wins, not max-wins).
 */
export function parseBaseline(text) {
  const baseline = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(.+?)\s+(\d+)$/);
    if (!m) continue;
    const [, file, locStr] = m;
    const loc = Number(locStr);
    if (!(file in baseline) || loc < baseline[file]) baseline[file] = loc;
  }
  return baseline;
}

function main() {
  // New files must stay under this; existing large files are carried in the
  // baseline and ratcheted down. Hard cap applies only to NEW files.
  const sizes = scanModuleSizesSync({ repoRoot: REPO_ROOT });

  if (process.argv.includes("--update")) {
    // Snapshot every file currently OVER the soft ceiling. Files at or under the
    // ceiling are not baselined — they are simply held to the ceiling as "new".
    const over = Object.keys(sizes)
      .filter((k) => sizes[k] > SOFT_CEILING)
      .sort();
    const baseline = Object.fromEntries(over.map((k) => [k, sizes[k]]));
    // Preserve the existing budget header (owner/expiry) across re-baselines;
    // extending an expiry is a deliberate owner act, never an --update side effect.
    let budget = DEFAULT_BUDGET;
    try {
      const existing = parseTxtBudgetHeader(readFileSync(BASELINE_PATH, "utf8"));
      if (existing.owner && existing.expiry) budget = existing;
    } catch {
      // no existing baseline — defaults apply
    }
    writeFileSync(BASELINE_PATH, serializeBaseline(baseline, budget));
    console.log(
      `Wrote module-size baseline: ${over.length} files over ${SOFT_CEILING} LOC (ratchet-down set).`,
    );
    process.exit(0);
  }

  let baseline = {};
  let baselineText = "";
  try {
    baselineText = readFileSync(BASELINE_PATH, "utf8");
    baseline = parseBaseline(baselineText);
  } catch {
    console.error(
      `Missing baseline ${relative(REPO_ROOT, BASELINE_PATH)} — run: node scripts/check-module-size.mjs --update`,
    );
    process.exit(1);
  }

  // BI-24115B65: tolerate union-merge duplicates (min LOC wins). Surface a
  // notice so contributors can optionally normalize with --update, but do
  // not fail a green merge on an intentional merge-driver artifact.
  const duplicatePaths = findDuplicateBaselinePaths(baselineText);
  if (duplicatePaths.length > 0) {
    console.warn(
      `Module-size baseline has ${duplicatePaths.length} union-merge duplicate path(s); ` +
        `using the smaller LOC for each (never loosens). Optional cleanup: ` +
        `node scripts/check-module-size.mjs --update`,
    );
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
}

// Run main() only when invoked directly, not when imported by the test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
