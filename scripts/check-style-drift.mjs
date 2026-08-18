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
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, relative } from "node:path";
import { isStyleDriftSource } from "./lib/gate-sensitivity.mjs";
import { formatBudgetedFileMap, readBudgetedFileMap } from "./lib/baseline-budget.mjs";

// Owned-expiring-budget shape (BI-3F17B16B): both baselines are budget
// envelopes ({version, owner, expiry, note, files}); freshness is enforced by
// scripts/check-no-expired-baseline-budgets.mjs. --update preserves the meta.
const DEFAULT_BUDGET = Object.freeze({ owner: "platform-architecture", expiry: "2026-11-16" });

function loadBudgetedBaseline(path) {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return readBudgetedFileMap(parsed);
}

function budgetFrom(path, note) {
  try {
    const { budget } = loadBudgetedBaseline(path);
    if (budget.owner && budget.expiry) return { ...budget, note };
  } catch {
    // fall through to defaults
  }
  return { ...DEFAULT_BUDGET, note };
}

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = join(REPO_ROOT, "apps", "web");
const SCAN_DIRS = ["app", "components", "lib", "hooks"].map((d) => join(WEB, d));
const BASELINE_PATH = join(REPO_ROOT, "scripts", "style-drift-baseline.json");
const TOKEN_BASELINE_PATH = join(REPO_ROOT, "scripts", "token-drift-baseline.json");

// Token / chart-theme files legitimately carry raw color values.
const APPROVED = [
  "apps/web/components/ui/report-kit/",
  "apps/web/components/ui/report-kit/chartTheme",
];
const APPROVED_NAME_RE = /(chartTheme|chart-theme|chart-colors|color-tokens)\./;

// Color-shaped hex literals: #rgb, #rgba, #rrggbb, #rrggbbaa.
const HEX_RE = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{4}\b|#[0-9a-fA-F]{3}\b/g;
// Pure-decimal token of a hex-valid length — NOT a color.
const DECIMAL_ONLY_RE = /^#[0-9]+$/;
const ALLOW_LINE = "style-drift-allow";

/**
 * Color-shaped hex matches on a single line, with all-decimal tokens removed.
 *
 * HEX_RE matches any `#` + N hex digits where N is a color length (3/4/6/8), so
 * an all-decimal token like `#2401` (a PR ref) or `#240100` also matches even
 * though it is not a color. A real CSS color always contains at least one a–f
 * digit; drop pure-decimal matches so `#2401`-style refs in comments don't
 * false-flag. (PIR-style false-positive fix, BI-OPT-RATCHETS.)
 */
export function colorHexMatches(line) {
  return (line.match(HEX_RE) || []).filter((m) => !DECIMAL_ONLY_RE.test(m));
}

// ─── Token drift: spacing / type / motion (BI-CBC7430F, EP-UX-SYSTEM L4) ─────
//
// The hex ratchet above covers COLOR. Since BI-CD81FF7C the platform also has
// spacing, type, elevation and motion scales (apps/web/design/tokens.json), so
// "off-scale" is finally a definable notion on those axes too — and the L2 UX
// budgets measure against them. Same ratchet contract as hex: a per-file baseline
// that may shrink but never grow, so no blind mass-rewrite is forced.
//
// Measured before the rules were chosen: spacing drift is ~11 occurrences repo-wide
// and motion drift is zero, but there are ~1,968 arbitrary text sizes — of which
// ~1,891 are the sub-legible text-[9px]/[10px]/[11px] the live UX audit flagged.
// Type is where the drift actually lives, which is why it is worth a gate.

/** Arbitrary font sizes — the type scale (text-dpf-*) carries paired line-heights. */
const ARBITRARY_TYPE_RE = /\btext-\[[0-9.]+(?:px|rem|em|pt)\]/g;

/** Spacing utilities with an arbitrary px value. */
const ARBITRARY_SPACING_RE =
  /\b(?:p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap|gap-x|gap-y|space-x|space-y)-\[([0-9.]+)px\]/g;

/** Arbitrary transition durations and inline keyframe definitions. */
const ARBITRARY_DURATION_RE = /\bduration-\[([0-9.]+)ms\]/g;
const ARBITRARY_ANIMATION_RE = /\banimate-\[/g;

/** Durations that exist as tokens (--dpf-duration-fast/base/slow). */
const TOKEN_DURATIONS = new Set([150, 200, 320]);

/** The spacing scale is a 4-pt progression; anything off that grid is off-scale. */
function isOffGrid(px) {
  const n = Number(px);
  return !Number.isFinite(n) || n % 4 !== 0;
}

/**
 * Off-scale token usages on a single line, grouped by axis.
 * Colour is deliberately NOT included — it has its own ratchet above.
 */
export function tokenDriftMatches(line) {
  const type = (line.match(ARBITRARY_TYPE_RE) || []).length;

  let spacing = 0;
  for (const m of line.matchAll(ARBITRARY_SPACING_RE)) {
    if (isOffGrid(m[1])) spacing += 1;
  }

  let motion = (line.match(ARBITRARY_ANIMATION_RE) || []).length;
  for (const m of line.matchAll(ARBITRARY_DURATION_RE)) {
    if (!TOKEN_DURATIONS.has(Number(m[1]))) motion += 1;
  }

  return { type, spacing, motion };
}

export const TOKEN_AXES = ["type", "spacing", "motion"];

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
      if (!isStyleDriftSource(rel)) continue;
      if (isApproved(rel)) continue;
      let count = 0;
      for (const line of readFileSync(file, "utf8").split("\n")) {
        if (line.includes(ALLOW_LINE)) continue;
        count += colorHexMatches(line).length;
      }
      if (count > 0) counts[rel] = count;
    }
  }
  return counts;
}

/** Count off-scale token usages per file, per axis. */
function scanTokens() {
  const counts = {};
  for (const dir of SCAN_DIRS) {
    for (const file of listSourceFiles(dir)) {
      const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
      if (!isStyleDriftSource(rel)) continue;
      if (isApproved(rel)) continue;
      const totals = { type: 0, spacing: 0, motion: 0 };
      for (const line of readFileSync(file, "utf8").split("\n")) {
        if (line.includes(ALLOW_LINE)) continue;
        const m = tokenDriftMatches(line);
        for (const axis of TOKEN_AXES) totals[axis] += m[axis];
      }
      if (TOKEN_AXES.some((a) => totals[a] > 0)) counts[rel] = totals;
    }
  }
  return counts;
}

/** Ratchet comparison for the per-axis token baseline. */
function compareTokens(counts, baseline) {
  const newFiles = [];
  const increased = [];
  for (const [file, axes] of Object.entries(counts)) {
    const prior = baseline[file];
    if (!prior) {
      const summary = TOKEN_AXES.filter((a) => axes[a] > 0).map((a) => `${a} +${axes[a]}`).join(", ");
      newFiles.push(`${file} (${summary})`);
      continue;
    }
    const grown = TOKEN_AXES.filter((a) => axes[a] > (prior[a] ?? 0));
    if (grown.length) {
      const summary = grown.map((a) => `${a} ${prior[a] ?? 0} -> ${axes[a]}`).join(", ");
      increased.push(`${file} (${summary})`);
    }
  }
  return { newFiles, increased };
}

function main() {
  const counts = scan();
  const tokenCounts = scanTokens();

  if (process.argv.includes("--update")) {
    writeFileSync(BASELINE_PATH, formatBudgetedFileMap(counts, budgetFrom(
      BASELINE_PATH,
      "Style-drift ratchet baseline (BI-ARCH-UI-PRIMS). Shrink-only: migrate a surface to --dpf-* tokens, then --update retightens. Regenerate with: node scripts/check-style-drift.mjs --update",
    )));
    writeFileSync(TOKEN_BASELINE_PATH, formatBudgetedFileMap(tokenCounts, budgetFrom(
      TOKEN_BASELINE_PATH,
      "Token-drift ratchet baseline (BI-CBC7430F, EP-UX-SYSTEM L4). Shrink-only per axis. Regenerate with: node scripts/check-style-drift.mjs --update",
    )));
    console.log(`Wrote style-drift baseline: ${Object.keys(counts).length} files with hardcoded hex.`);
    console.log(
      `Wrote token-drift baseline: ${Object.keys(tokenCounts).length} files with off-scale spacing/type/motion.`,
    );
    process.exit(0);
  }

  let baseline = {};
  try {
    baseline = loadBudgetedBaseline(BASELINE_PATH).files;
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

  let tokenBaseline = {};
  try {
    tokenBaseline = loadBudgetedBaseline(TOKEN_BASELINE_PATH).files;
  } catch {
    console.error(
      `Missing baseline ${relative(REPO_ROOT, TOKEN_BASELINE_PATH)} — run: node scripts/check-style-drift.mjs --update`,
    );
    process.exit(1);
  }
  const token = compareTokens(tokenCounts, tokenBaseline);

  // Report BOTH ratchets before exiting so one run shows every problem.
  let failed = false;

  if (newFiles.length > 0 || increased.length > 0) {
    failed = true;
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
  }

  if (token.newFiles.length > 0 || token.increased.length > 0) {
    failed = true;
    console.error("\nToken drift — new off-scale spacing/type/motion (EP-UX-SYSTEM L0/L4).");
    console.error("Use the generated scales instead of arbitrary values:");
    console.error("  type    text-dpf-caption|body|body-lg|title|heading|display  (each carries its line-height)");
    console.error("  spacing p-dpf-*/gap-dpf-*, or any 4-pt value — arbitrary px off the 4-pt grid is flagged");
    console.error("  motion  animate-dpf-*, ease-dpf-*, duration-[var(--dpf-duration-base)]");
    console.error("See docs/platform-usability-standards.md -> Design Token Scales (L0).\n");
    if (token.newFiles.length) {
      console.error("New files with off-scale values:");
      for (const f of token.newFiles) console.error(`  - ${f}`);
    }
    if (token.increased.length) {
      console.error("More off-scale values than the baseline:");
      for (const f of token.increased) console.error(`  - ${f}`);
    }
    console.error("\nIf you intentionally migrated a file, run --update to retighten the baseline.");
  }

  if (failed) process.exit(1);

  const total = Object.values(baseline).reduce((a, b) => a + b, 0);
  const tokenTotals = TOKEN_AXES.map(
    (a) => `${Object.values(tokenBaseline).reduce((s, f) => s + (f[a] ?? 0), 0)} ${a}`,
  ).join(" / ");
  console.log(
    `Style drift OK — no new hardcoded hex. Baseline: ${Object.keys(baseline).length} files / ${total} known hex (migrate as touched).`,
  );
  console.log(
    `Token drift OK — no new off-scale values. Baseline: ${Object.keys(tokenBaseline).length} files / ${tokenTotals} (migrate as touched).`,
  );
}

// Run main() only when invoked directly, not when imported by the test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
