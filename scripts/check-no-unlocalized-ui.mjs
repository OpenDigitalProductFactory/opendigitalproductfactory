#!/usr/bin/env node
/**
 * BI-4690CB37 (EP-6B33A840 L0.3): a localization ratchet. English-only and
 * direction-bound UI debt may only shrink.
 *
 * Design: docs/superpowers/specs/2026-09-25-localization-foundation-design.md
 * (OBJ-NO-REGRESSION, AC-GUARD). Runbook: docs/architecture/localization-runbook.md.
 *
 * Counts four categories per file and freezes them in a baseline that can only
 * go DOWN (same shape as check-no-hand-rolled-loading and the module-size guard):
 *
 *   jsx-copy            bare multi-word English JSX text, and capitalized
 *                       placeholder / aria-label / title / alt string literals
 *                       -> move the copy into the message catalog (L0.2)
 *   locale-literal      "en-GB" / "en-US" literals, and toLocale*String("xx")
 *                       with a literal locale -> use getLocaleContext() / lib/format
 *   physical-direction  Tailwind ml/mr/pl/pr/left/right/border-l/r/rounded-l/r/
 *                       text-left/right, and marginLeft/paddingRight/textAlign:
 *                       "left"-style inline styles -> use logical ms/me/ps/pe/
 *                       start/end/border-s/e/rounded-s/e/text-start/end (L0.6)
 *   money-prefix        `$${...}` templates and a literal >$< -> formatMoney
 *
 * A new file must count zero; an existing file's count may not grow. Counts are
 * a regex approximation by design: the ratchet only needs to be monotonic.
 *
 * Baseline: scripts/unlocalized-ui-baseline.txt, `<path>\t<category>\t<count>`,
 * with a budget header (owner, expiry) per check-no-expired-baseline-budgets.
 *
 *   node scripts/check-no-unlocalized-ui.mjs            # check (CI, repo guard loop)
 *   node scripts/check-no-unlocalized-ui.mjs --update   # regenerate after migrating
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { formatTxtBudgetHeader } from "./lib/baseline-budget.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = join(REPO_ROOT, "scripts", "unlocalized-ui-baseline.txt");
const DEFAULT_BUDGET = { owner: "platform-architecture", expiry: "2027-03-31" };

export const CATEGORIES = ["jsx-copy", "locale-literal", "physical-direction", "money-prefix"];

const SCAN_ROOTS = ["apps/web/app", "apps/web/components", "apps/web/lib"];
// packages/i18n holds locale tags on purpose; it is the catalog's home.
const EXCLUDED_PREFIXES = ["packages/i18n/"];

// A class token prefix: optional variants such as `md:` or `hover:` and an optional `-`.
const V = String.raw`(?<![\w-])(?:[a-z0-9-]+:)*-?`;
const PHYSICAL_CLASS_RE = new RegExp(
  String.raw`${V}(?:(?:ml|mr|pl|pr|left|right|scroll-ml|scroll-mr|scroll-pl|scroll-pr)-[\w./[\]-]+|(?:border-l|border-r|rounded-l|rounded-r|rounded-tl|rounded-tr|rounded-bl|rounded-br)(?:-[\w./[\]-]+)?|text-(?:left|right))(?![\w-])`,
  "g",
);
const PHYSICAL_STYLE_RE =
  /\b(?:marginLeft|marginRight|paddingLeft|paddingRight|borderLeft\w*|borderRight\w*)\s*:|\btextAlign\s*:\s*["'](?:left|right)["']|(?<![\w.-])(?:left|right)\s*:\s*(?:["'`]|-?\d)/g;
const LOCALE_LITERAL_RE = /["'`]en-(?:GB|US)["'`]|toLocale(?:Date|Time)?String\(\s*["'`](?!en-(?:GB|US)["'`])[a-z]{2,3}(?:-[A-Za-z0-9]+)*["'`]/g;
// `$${...}` also builds SQL placeholders ($1: `$${params.length}`, `$${paramIdx}`)
// and spreadsheet absolute refs (`$${columnLetter(i)}`); those are not money.
const MONEY_PREFIX_RE =
  /\$\$\{(?!\s*(?:params\.length|\w*(?:[Pp]aram|[Ii]dx|[Ii]ndex)\w*\s*\}|columnLetter\())|>\$</g;
const JSX_TEXT_RE = />\s*([A-Z][a-z]+(?:[ ,'’!?:.-]+[A-Za-z][a-z]*)+)[.!?]?\s*</g;
const JSX_ATTR_RE = /\b(?:placeholder|aria-label|title|alt)=["'][A-Z][^"'{}]*["']/g;

/** Drop comments so a class named in prose is not counted. Approximate by design. */
export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\w])\/\/.*$/gm, "$1");
}

function count(re, text) {
  return (text.match(re) ?? []).length;
}

/** Category counts for one file's source text. `isTsx` enables the JSX copy category. */
export function countCategories(source, { isTsx }) {
  const text = stripComments(source);
  return {
    "jsx-copy": isTsx ? count(JSX_TEXT_RE, text) + count(JSX_ATTR_RE, text) : 0,
    "locale-literal": count(LOCALE_LITERAL_RE, text),
    "physical-direction": count(PHYSICAL_CLASS_RE, text) + count(PHYSICAL_STYLE_RE, text),
    "money-prefix": count(MONEY_PREFIX_RE, text),
  };
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
      if (["node_modules", ".next", "dist", "generated", "__snapshots__", "__fixtures__"].includes(entry)) continue;
      yield* walk(full);
    } else if (s.isFile()) {
      if (!/\.(ts|tsx)$/.test(full) || full.endsWith(".d.ts")) continue;
      if (/\.(test|spec|stories)\.(ts|tsx)$/.test(full) || /\.generated\./.test(full)) continue;
      yield full;
    }
  }
}

function scanRoots(root) {
  const roots = SCAN_ROOTS.map((r) => join(root, r));
  const packagesDir = join(root, "packages");
  if (existsSync(packagesDir)) {
    for (const pkg of readdirSync(packagesDir)) {
      const src = join(packagesDir, pkg, "src");
      if (existsSync(src)) roots.push(src);
    }
  }
  return roots;
}

/** `{ "<path>\t<category>": count }` for every non-zero count. */
export function scan(root = REPO_ROOT) {
  const counts = {};
  for (const scanRoot of scanRoots(root)) {
    for (const file of walk(scanRoot)) {
      const rel = relative(root, file).replace(/\\/g, "/");
      if (EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))) continue;
      const found = countCategories(readFileSync(file, "utf8"), { isTsx: file.endsWith(".tsx") });
      for (const category of CATEGORIES) {
        if (found[category] > 0) counts[`${rel}\t${category}`] = found[category];
      }
    }
  }
  return counts;
}

/** Parse `<path>\t<category>\t<count>` lines; a union-merge duplicate resolves to the MIN (shrink wins). */
export function parseBaseline(text) {
  const counts = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split("\t");
    if (parts.length !== 3 || !CATEGORIES.includes(parts[1]) || !/^\d+$/.test(parts[2])) continue;
    const key = `${parts[0]}\t${parts[1]}`;
    const n = Number(parts[2]);
    counts[key] = key in counts ? Math.min(counts[key], n) : n;
  }
  return counts;
}

export function diff(current, baseline) {
  const grew = [];
  const fresh = [];
  for (const [key, n] of Object.entries(current)) {
    const label = key.replace("\t", " [") + "]";
    if (key in baseline) {
      if (n > baseline[key]) grew.push(`${label} ${baseline[key]} -> ${n}`);
    } else {
      fresh.push(`${label} ${n}`);
    }
  }
  return { grew, fresh };
}

export function totalsByCategory(counts) {
  const totals = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  for (const [key, n] of Object.entries(counts)) totals[key.split("\t")[1]] += n;
  return totals;
}

function serialize(counts) {
  const header = formatTxtBudgetHeader({
    ...DEFAULT_BUDGET,
    noteLines: [
      "BI-4690CB37 localization ratchet: <path>\\t<category>\\t<count>; counts may only shrink.",
      "Regenerate after migrating a surface: node scripts/check-no-unlocalized-ui.mjs --update",
    ],
  });
  const body = Object.keys(counts)
    .sort()
    .map((key) => `${key}\t${counts[key]}`)
    .join("\n");
  return `${header}${body}\n`;
}

function describeTotals(totals) {
  return CATEGORIES.map((c) => `${c} ${totals[c]}`).join(", ");
}

function main() {
  const current = scan();

  if (process.argv.includes("--update")) {
    writeFileSync(BASELINE_PATH, serialize(current));
    console.log(`Wrote unlocalized-ui baseline: ${describeTotals(totalsByCategory(current))}.`);
    return;
  }

  let baseline;
  try {
    baseline = parseBaseline(readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    console.error(`Missing ${relative(REPO_ROOT, BASELINE_PATH)} - run: node scripts/check-no-unlocalized-ui.mjs --update`);
    process.exit(1);
  }

  const { grew, fresh } = diff(current, baseline);
  if (grew.length > 0 || fresh.length > 0) {
    console.error("");
    console.error("ERROR: BI-4690CB37 - new English-only or direction-bound UI code.");
    console.error("");
    console.error("Replace it instead of adding to it:");
    console.error("  jsx-copy            put user-facing copy in the message catalog (docs/architecture/localization-runbook.md)");
    console.error('  locale-literal      read the viewer\'s locale from getLocaleContext() instead of "en-US"/"en-GB"');
    console.error("  physical-direction  use logical classes: ms/me, ps/pe, start/end, border-s/e, rounded-s/e, text-start/end");
    console.error("  money-prefix        format amounts with formatMoney from @/lib/org-locale/org-locale");
    console.error("");
    if (fresh.length) {
      console.error("New files or categories (must be zero):");
      for (const f of fresh) console.error(`  - ${f}`);
    }
    if (grew.length) {
      console.error("Counts that GREW (the baseline only allows shrinking):");
      for (const f of grew) console.error(`  - ${f}`);
    }
    console.error("");
    console.error("If you intentionally MIGRATED a surface (a count dropped), run --update to retighten.");
    process.exit(1);
  }

  console.log(`✓ No new unlocalized UI (baseline pending migration: ${describeTotals(totalsByCategory(baseline))}).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
