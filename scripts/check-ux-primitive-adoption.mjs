#!/usr/bin/env node
// UX primitive-adoption ratchet — BI-D25ED55D (Simplify & Strengthen W5,
// architecture pass 2026-08-16 §3.3-b / §4-P1).
//
// The pass's P1 finding: the platform builds the right primitive and leaves
// adoption voluntary. This guard is the ratchet half of the W5 UX foundation
// pack (ui/Button, ui/Surface, --dpf-on-accent): it freezes the residual
// hand-rolled sites in an owned, expiring baseline and fails NEW growth.
//
// Three shrink-only per-file budgets over apps/web source (sibling pattern:
// check-fk-index-coverage.mjs for the baseline contract,
// check-no-hand-rolled-loading.mjs for per-file counts):
//
//   1. accentButton — inline accent-fill class strings (`bg-[var(--dpf-accent)]`)
//      OUTSIDE components/ui. The canonical home is ui/Button (or, for the
//      form contract, form/styles.ts primaryButtonClass).
//   2. cardString — the inline card pattern (`border-[var(--dpf-border)]` and
//      `bg-[var(--dpf-surface-1)]` composed in one class string) OUTSIDE
//      components/ui. The canonical home is ui/Surface.
//   3. textWhite — `text-white` anywhere in apps/web source (including
//      components/ui, where it must stay at zero). The old "exception:
//      text-white on accent buttons" is retired — the label token is
//      --dpf-on-accent (globals.css).
//
// A NEW file, or MORE occurrences in an already-listed file, fails; a shrink
// passes and reports so the author retightens with --update in the same PR.
// The baseline carries an owner and an expiry date — an expired baseline fails
// until it is re-reviewed and deliberately extended.
//
// Plus one ABSOLUTE coverage rule (BI-DD5FC4FF, W7 — not a baseline): every
// top-level route group under apps/web/app that renders pages (contains a
// page.tsx anywhere below it; `api` and route-handler-only segments are
// naturally excluded) must carry error.tsx AND loading.tsx at its top level.
// A new route group without its failure/loading face fails immediately.
//
//   node scripts/check-ux-primitive-adoption.mjs            # check (CI)
//   node scripts/check-ux-primitive-adoption.mjs --update   # retighten
//
// Spec: docs/superpowers/specs/2026-08-16-ux-foundation-button-surface-design.md

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = join(dirname(SCRIPT_PATH), "..");
export const SCAN_DIR = join(REPO_ROOT, "apps", "web");
export const BASELINE_PATH = join(REPO_ROOT, "scripts", "ux-primitive-adoption-baseline.json");

// The canonical primitive home — accentButton/cardString budgets never count it.
export const UI_HOME = "apps/web/components/ui";

// Directories under apps/web worth scanning for rendered/authored UI strings.
export const SCAN_SUBDIRS = ["app", "components", "lib", "hooks"];

export const ACCENT_BUTTON_RE = /bg-\[var\(--dpf-accent\)\]/g;
// The card pattern in either order inside one string literal. The `(?<!:)`
// lookbehinds keep state-variant utilities (hover:bg-…, focus:border-…) from
// reading as a card — a secondary button's hover state is not a Surface.
export const CARD_STRING_RE =
  /(?<!:)border-\[var\(--dpf-border\)\][^"'`]*(?<!:)bg-\[var\(--dpf-surface-1\)\]|(?<!:)bg-\[var\(--dpf-surface-1\)\][^"'`]*(?<!:)border-\[var\(--dpf-border\)\]/g;
export const TEXT_WHITE_RE = /\btext-white\b/g;

export const BUDGET_KEYS = Object.freeze(["accentButton", "cardString", "textWhite"]);

function isSourceFile(name) {
  return (
    /\.(ts|tsx)$/.test(name) &&
    !/\.(test|spec|stories)\.(ts|tsx)$/.test(name) &&
    !name.endsWith(".d.ts")
  );
}

/** Repo-relative (forward-slash) paths of every scannable source file. */
export function listSourceFiles(scanDir = SCAN_DIR, subdirs = SCAN_SUBDIRS) {
  const acc = [];
  function walk(abs) {
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = join(abs, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".next") continue;
        walk(child);
      } else if (entry.isFile() && isSourceFile(entry.name)) {
        acc.push(relative(REPO_ROOT, child).split("\\").join("/"));
      }
    }
  }
  for (const sub of subdirs) walk(join(scanDir, sub));
  return acc.sort();
}

export function countMatches(source, re) {
  return (source.match(re) ?? []).length;
}

/**
 * Compute the three per-file budget maps for a set of {path, source} entries.
 * Returns { accentButton: {path: n}, cardString: {...}, textWhite: {...} }
 * with zero-count files omitted.
 */
export function computeBudgets(files) {
  const budgets = { accentButton: {}, cardString: {}, textWhite: {} };
  for (const { path, source } of files) {
    const inUiHome = path.startsWith(`${UI_HOME}/`);
    if (!inUiHome) {
      const accent = countMatches(source, ACCENT_BUTTON_RE);
      if (accent > 0) budgets.accentButton[path] = accent;
      const card = countMatches(source, CARD_STRING_RE);
      if (card > 0) budgets.cardString[path] = card;
    }
    const white = countMatches(source, TEXT_WHITE_RE);
    if (white > 0) budgets.textWhite[path] = white;
  }
  return budgets;
}

export const APP_DIR = join(SCAN_DIR, "app");

/**
 * Boundary coverage (BI-DD5FC4FF): top-level segments of apps/web/app that
 * contain at least one page.tsx must have error.tsx + loading.tsx at their
 * top level. `api` is excluded; segments with only route handlers have no
 * page.tsx and are excluded by construction.
 *
 * Injectable fs surface for tests: { readdir(dir) -> Dirent[], exists(path) }.
 */
export function checkBoundaryCoverage({
  appDir = APP_DIR,
  readdir = (dir) => readdirSync(dir, { withFileTypes: true }),
  exists = existsSync,
} = {}) {
  const missing = [];
  const groups = [];

  const containsPage = (dir) => {
    let entries;
    try {
      entries = readdir(dir);
    } catch {
      return false;
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name === "page.tsx") return true;
      if (entry.isDirectory() && entry.name !== "node_modules") {
        if (containsPage(join(dir, entry.name))) return true;
      }
    }
    return false;
  };

  let top;
  try {
    top = readdir(appDir);
  } catch {
    return { groups, missing };
  }
  for (const entry of top) {
    if (!entry.isDirectory() || entry.name === "api") continue;
    const dir = join(appDir, entry.name);
    if (!containsPage(dir)) continue;
    groups.push(entry.name);
    for (const boundary of ["error.tsx", "loading.tsx"]) {
      if (!exists(join(dir, boundary))) {
        missing.push(`apps/web/app/${entry.name}/${boundary}`);
      }
    }
  }
  return { groups: groups.sort(), missing: missing.sort() };
}

export function validateBaseline(baseline, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const failures = [];
  if (baseline?.version !== 1) failures.push("Baseline version must be 1.");
  if (!baseline?.owner?.trim()) failures.push("Baseline requires an owner.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(baseline?.expiry ?? "")) {
    failures.push("Baseline requires expiry in YYYY-MM-DD form.");
  } else if (baseline.expiry < today) {
    failures.push(
      `Baseline expired on ${baseline.expiry} — re-review the budgets and deliberately extend the expiry.`,
    );
  }
  for (const key of BUDGET_KEYS) {
    const map = baseline?.[key];
    if (!map || typeof map !== "object" || Array.isArray(map)) {
      failures.push(`Baseline ${key} must be an object of {path: count}.`);
    }
  }
  return failures;
}

/**
 * Ratchet one budget map. A new path, or a higher count on a known path,
 * fails; a lower/gone count is stale (pass + retighten hint).
 */
export function evaluateBudget(current, baselined) {
  const growth = [];
  const stale = [];
  for (const [path, count] of Object.entries(current)) {
    const budget = baselined[path];
    if (budget === undefined) growth.push(`${path} (new, ${count})`);
    else if (count > budget) growth.push(`${path} (${budget} -> ${count})`);
  }
  for (const [path, budget] of Object.entries(baselined)) {
    const count = current[path] ?? 0;
    if (count < budget) stale.push(`${path} (${budget} -> ${count})`);
  }
  return { growth: growth.sort(), stale: stale.sort() };
}

export function runCheck({ files, baseline, today, boundary = { groups: [], missing: [] } }) {
  const budgets = computeBudgets(files);
  const baselineFailures = validateBaseline(baseline, today ? { today } : {});
  if (baselineFailures.length) return { ok: false, baselineFailures, budgets, boundary };
  const evaluation = {};
  let ok = boundary.missing.length === 0;
  for (const key of BUDGET_KEYS) {
    evaluation[key] = evaluateBudget(budgets[key], baseline[key]);
    if (evaluation[key].growth.length > 0) ok = false;
  }
  return { ok, baselineFailures: [], budgets, evaluation, boundary };
}

function readFiles() {
  return listSourceFiles().map((path) => ({
    path,
    source: readFileSync(join(REPO_ROOT, path), "utf8"),
  }));
}

const budgetTotal = (map) => Object.values(map).reduce((a, b) => a + b, 0);

function main() {
  const files = readFiles();

  if (process.argv.includes("--update")) {
    let owner = "platform-architecture";
    let expiry = "2026-11-16";
    try {
      const existing = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
      owner = existing.owner ?? owner;
      expiry = existing.expiry ?? expiry;
    } catch {
      // first write — defaults above
    }
    const budgets = computeBudgets(files);
    const baseline = {
      version: 1,
      owner,
      expiry,
      note:
        "UX primitive-adoption ratchet baseline (BI-D25ED55D). Shrink-only: a site leaves this list by composing ui/Button, ui/Surface, or text-[var(--dpf-on-accent)], never by expanding the baseline. Regenerate with: node scripts/check-ux-primitive-adoption.mjs --update",
      ...budgets,
    };
    writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(
      `Wrote UX primitive-adoption baseline: ${budgetTotal(budgets.accentButton)} accent-button, ` +
        `${budgetTotal(budgets.cardString)} card-string, ${budgetTotal(budgets.textWhite)} text-white occurrences.`,
    );
    return;
  }

  let baseline;
  try {
    baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    console.error(
      "Missing/unreadable scripts/ux-primitive-adoption-baseline.json — run: node scripts/check-ux-primitive-adoption.mjs --update",
    );
    process.exit(1);
  }

  const result = runCheck({ files, baseline, boundary: checkBoundaryCoverage() });
  if (result.baselineFailures.length) {
    console.error("UX primitive-adoption baseline is invalid:");
    for (const f of result.baselineFailures) console.error(`  - ${f}`);
    process.exit(1);
  }

  if (!result.ok) {
    console.error("UX primitive-adoption ratchet failed (BI-D25ED55D).\n");
    const remedy = {
      accentButton:
        "NEW inline accent-button strings (compose ui/Button — or form/styles.ts primaryButtonClass inside the form contract):",
      cardString: "NEW inline card strings (compose ui/Surface):",
      textWhite:
        "NEW text-white occurrences (labels on accent/error fills use text-[var(--dpf-on-accent)]):",
    };
    for (const key of BUDGET_KEYS) {
      const { growth } = result.evaluation[key];
      if (growth.length === 0) continue;
      console.error(remedy[key]);
      for (const g of growth) console.error(`  - ${g}`);
      console.error("");
    }
    if (result.boundary.missing.length > 0) {
      console.error("Route groups rendering pages MUST carry error.tsx + loading.tsx at the");
      console.error("group top level (BI-DD5FC4FF; compose ui/ErrorBoundaryCard + report-kit Skeleton):");
      for (const m of result.boundary.missing) console.error(`  - ${m} is missing`);
      console.error("");
    }
    console.error("Do not expand the baseline without an owned platform-architecture decision.");
    process.exit(1);
  }

  const staleAll = BUDGET_KEYS.flatMap((key) =>
    result.evaluation[key].stale.map((s) => `${key}: ${s}`),
  );
  if (staleAll.length > 0) {
    console.warn(
      `UX primitive-adoption debt shrank by ${staleAll.length} file budget(s) — retighten the baseline in this PR with --update:`,
    );
    for (const s of staleAll) console.warn(`  - ${s}`);
  }
  console.log(
    `UX primitive adoption OK — accent-button ${budgetTotal(result.budgets.accentButton)}/${budgetTotal(baseline.accentButton)}, ` +
      `card-string ${budgetTotal(result.budgets.cardString)}/${budgetTotal(baseline.cardString)}, ` +
      `text-white ${budgetTotal(result.budgets.textWhite)}/${budgetTotal(baseline.textWhite)} ` +
      `(current/budget), ${result.boundary.groups.length} route group(s) boundary-covered, ` +
      `owner ${baseline.owner}, review by ${baseline.expiry}.`,
  );
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main();
}
