#!/usr/bin/env node
// Build Studio surface ratchet — BI-101C107C (kernel consult DI-BCC92F9AFC08).
//
// The finding: between 2026-04-01 and 2026-08-21 the Build Studio operator UI
// grew from 8 components / 705 non-test LOC to 74 / 16,573, across 39 design
// specs and 28 implementation plans, and exactly ONE component was ever deleted
// (SandboxPreview.tsx). Six of those documents are full-surface redesigns; six
// more carry "streamlining / simplification / convergence / reconciliation" in
// the title. The line never went down in any month.
//
// The mechanism is legible in one commit. PR #3693 ("feat: simplify Build
// Studio around outcomes") implemented the 2026-07-28 outcome-first plan as
// +856/-516 — net +340 lines, +2 modules, 0 components removed. It ADDED the
// simplified view next to the thing it was meant to simplify, so the operator
// now sees both. Every existing UX guard is a PRESENCE check
// (check-ux-fit-decision, check-ux-primitive-adoption), so all 28 plans passed
// by writing a "UX-fit review: Fits with guardrails" paragraph. Nothing failed
// a "simplification" PR that added net lines and deleted nothing.
//
// This is the ratchet that closes it. Two ABSOLUTE shrink-only budgets over
// apps/web/components/build (sibling pattern: check-ux-primitive-adoption.mjs
// for the owned-expiring-baseline contract):
//
//   1. componentCount — non-test .ts/.tsx files under the Build Studio UI root.
//   2. nonTestLoc     — total non-test lines under the same root.
//
// Either number going UP fails. Either going DOWN passes and reports the
// retighten hint so the author locks the win in the same PR. Unlike the
// per-file budgets in the sibling guard these are deliberately whole-surface
// totals: the failure mode being closed is aggregate accretion, and a per-file
// map would let a PR add a component while shrinking another and net out flat.
//
// The baseline carries an owner and an expiry date — an expired baseline fails
// until it is re-reviewed and deliberately extended, so "we'll simplify later"
// cannot quietly become never.
//
//   node scripts/check-build-studio-surface-budget.mjs            # check (CI)
//   node scripts/check-build-studio-surface-budget.mjs --update   # retighten
//
// BI: BI-101C107C. Sequencing decision: DI-BCC92F9AFC08 (ratchet-first,
// composite 12.49, margin 1.70, high confidence, no commandment conflict).

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = join(dirname(SCRIPT_PATH), "..");
export const SURFACE_DIR = join(REPO_ROOT, "apps", "web", "components", "build");
export const BASELINE_PATH = join(
  REPO_ROOT,
  "scripts",
  "build-studio-surface-baseline.json",
);

export const BUDGET_KEYS = Object.freeze(["componentCount", "nonTestLoc"]);

/** Source files that count toward the surface: non-test, non-declaration. */
export function isSurfaceFile(name) {
  return (
    /\.(ts|tsx)$/.test(name) &&
    !/\.(test|spec|stories)\.(ts|tsx)$/.test(name) &&
    !name.endsWith(".d.ts")
  );
}

/** Repo-relative (forward-slash) paths of every counted surface file. */
export function listSurfaceFiles(surfaceDir = SURFACE_DIR) {
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
      } else if (entry.isFile() && isSurfaceFile(entry.name)) {
        acc.push(relative(REPO_ROOT, child).split("\\").join("/"));
      }
    }
  }
  walk(surfaceDir);
  return acc.sort();
}

export function countLines(source) {
  if (source === "") return 0;
  const withoutTrailingNewline = source.endsWith("\n") ? source.slice(0, -1) : source;
  return withoutTrailingNewline.split("\n").length;
}

/**
 * Compute the two absolute budgets for a set of {path, source} entries.
 * Returns { componentCount, nonTestLoc }.
 */
export function computeBudgets(files) {
  return {
    componentCount: files.length,
    nonTestLoc: files.reduce((total, { source }) => total + countLines(source), 0),
  };
}

export function validateBaseline(baseline, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const failures = [];
  if (baseline?.version !== 1) failures.push("Baseline version must be 1.");
  if (!baseline?.owner?.trim()) failures.push("Baseline requires an owner.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(baseline?.expiry ?? "")) {
    failures.push("Baseline requires expiry in YYYY-MM-DD form.");
  } else if (baseline.expiry < today) {
    failures.push(
      `Baseline expired on ${baseline.expiry} — re-review the Build Studio surface and deliberately extend the expiry.`,
    );
  }
  for (const key of BUDGET_KEYS) {
    if (typeof baseline?.[key] !== "number" || !Number.isFinite(baseline[key])) {
      failures.push(`Baseline ${key} must be a number.`);
    }
  }
  return failures;
}

/**
 * Ratchet one absolute budget. Above baseline fails; below baseline is stale
 * (pass + retighten hint).
 */
export function evaluateBudget(current, baselined) {
  if (current > baselined) return { growth: current - baselined, stale: 0 };
  if (current < baselined) return { growth: 0, stale: baselined - current };
  return { growth: 0, stale: 0 };
}

export function runCheck({ files, baseline, today }) {
  const budgets = computeBudgets(files);
  const baselineFailures = validateBaseline(baseline, today ? { today } : {});
  if (baselineFailures.length) return { ok: false, baselineFailures, budgets };
  const evaluation = {};
  let ok = true;
  for (const key of BUDGET_KEYS) {
    evaluation[key] = evaluateBudget(budgets[key], baseline[key]);
    if (evaluation[key].growth > 0) ok = false;
  }
  return { ok, baselineFailures: [], budgets, evaluation };
}

function readFiles() {
  return listSurfaceFiles().map((path) => ({
    path,
    source: readFileSync(join(REPO_ROOT, path), "utf8"),
  }));
}

const NOTE =
  "Build Studio surface ratchet baseline (BI-101C107C). Shrink-only: the Build Studio UI " +
  "surface leaves this budget by DELETING or CONVERGING components, never by expanding the " +
  "baseline. A 'simplification' that adds net lines is not a simplification. " +
  "Regenerate with: node scripts/check-build-studio-surface-budget.mjs --update";

function main() {
  const files = readFiles();

  if (process.argv.includes("--update")) {
    let owner = "platform-architecture";
    let expiry = "2026-11-21";
    try {
      const existing = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
      owner = existing.owner ?? owner;
      expiry = existing.expiry ?? expiry;
    } catch {
      // first write — defaults above
    }
    const budgets = computeBudgets(files);
    const baseline = { version: 1, owner, expiry, note: NOTE, ...budgets };
    writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(
      `Wrote Build Studio surface baseline: ${budgets.componentCount} components, ` +
        `${budgets.nonTestLoc} non-test LOC.`,
    );
    return;
  }

  let baseline;
  try {
    baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    console.error(
      "Missing/unreadable scripts/build-studio-surface-baseline.json — run: node scripts/check-build-studio-surface-budget.mjs --update",
    );
    process.exit(1);
  }

  const result = runCheck({ files, baseline });
  if (result.baselineFailures.length) {
    console.error("Build Studio surface baseline is invalid:");
    for (const f of result.baselineFailures) console.error(`  - ${f}`);
    process.exit(1);
  }

  if (!result.ok) {
    console.error("Build Studio surface ratchet failed (BI-101C107C).\n");
    const label = {
      componentCount: "components under apps/web/components/build",
      nonTestLoc: "non-test lines under apps/web/components/build",
    };
    for (const key of BUDGET_KEYS) {
      const { growth } = result.evaluation[key];
      if (growth === 0) continue;
      console.error(
        `  ${label[key]}: ${baseline[key]} -> ${result.budgets[key]} (+${growth})`,
      );
    }
    console.error("");
    console.error("Build Studio's surface may not grow. Five months of additive");
    console.error("'simplification' produced 74 components and one deletion; this guard");
    console.error("exists so that cannot recur. If this change genuinely needs new surface,");
    console.error("REMOVE the surface it replaces in the same PR — that is what makes it a");
    console.error("replacement rather than another layer. Raising the baseline requires an");
    console.error("owned platform-architecture decision, not a passing build.");
    process.exit(1);
  }

  const shrank = BUDGET_KEYS.filter((key) => result.evaluation[key].stale > 0);
  if (shrank.length > 0) {
    console.warn(
      "Build Studio surface shrank — retighten the baseline in this PR with --update:",
    );
    for (const key of shrank) {
      console.warn(
        `  - ${key}: ${baseline[key]} -> ${result.budgets[key]} (-${result.evaluation[key].stale})`,
      );
    }
  }
  console.log(
    `Build Studio surface ratchet OK: ${result.budgets.componentCount} components, ` +
      `${result.budgets.nonTestLoc} non-test LOC (baseline ${baseline.componentCount}/${baseline.nonTestLoc}, expires ${baseline.expiry}).`,
  );
}

if (process.argv[1] && process.argv[1].endsWith("check-build-studio-surface-budget.mjs")) {
  main();
}
