#!/usr/bin/env node
// scripts/sbom/check-sbom-drift.mjs
//
// Reduction/efficiency guard — the proactive counterpart to Dependabot.
// Dependabot spots vulnerabilities + lifecycle (reactive, per-package).
// This guard spots DEPENDENCY-SHAPE regressions across the whole monorepo
// that Dependabot structurally cannot see:
//
//   HARD GATE  — a NEW first-party version split (our own workspaces start
//                declaring a package at incompatible versions). Dependabot
//                bumps one package at a time and is configured never to move
//                majors for typescript/react/expo, so it will never flag this.
//   HARD GATE  — a shape total above its budget in sbom/baseline.json
//                (resolved components, duplicated names, excess instances,
//                multi-major names). "The dependency surface only shrinks"
//                (absorb-dont-adopt, commandment tier), so budgets are ceilings:
//                --update-baseline only lowers them, and raising one takes a
//                recorded reason that is reviewed in the PR diff
//                (plan 2026-09-08 §7).
//   REPORT     — every total vs the baseline, printed for visibility.
//
// Pure Node: no install, runs in seconds. Mirrors the repo's other
// scripts/check-*.mjs CI guards.
//
// Usage:
//   node scripts/sbom/check-sbom-drift.mjs                    # gate (CI / pre-PR)
//   node scripts/sbom/check-sbom-drift.mjs --update-baseline  # accept current shape; budgets only go down
//   node scripts/sbom/check-sbom-drift.mjs --raise-budget "<reason>"
//       # move budgets to the current totals and record why in sbom/baseline.json

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generatePlatformSbom } from "./generate-platform-sbom.mjs";
import { LOCKFILE_ROOTS } from "./lockfile-roots.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASELINE_PATH = join(ROOT, "sbom", "baseline.json");

/** Budgeted totals. Each is a count where lower is better. */
export const BUDGETED_TOTALS = ["resolvedComponents", "duplicatedNames", "excessInstances", "multiMajorNames"];

const BASELINE_NOTE =
  "Drift anchor for scripts/check-sbom-drift.mjs. `firstPartyDivergent` lists the accepted set of packages whose own workspace declarations resolve to >1 version; the guard fails when a NEW name appears. `budgets` are ceilings on the dependency shape; the guard fails when a total exceeds its budget. --update-baseline only lowers budgets. Raising one needs --raise-budget \"<reason>\", which records the reason in `lastBudgetRaise` for review. Never raise a budget to absorb growth that `pnpm dedupe` or a removal would clear. See docs/architecture/dependency-reduction-routine.md.";

/** Compare totals to budgets. A total with no numeric budget is not gated. */
export function evaluateBudgets(totals, budgets = {}) {
  const over = [];
  const under = [];
  for (const key of BUDGETED_TOTALS) {
    const budget = budgets?.[key];
    if (typeof budget !== "number") continue;
    const current = totals[key];
    if (current > budget) over.push({ key, current, budget });
    else if (current < budget) under.push({ key, current, budget });
  }
  return { over, under };
}

/**
 * Next budgets. Without `raise` a budget can only fall to the current total;
 * with it, every budget moves to the current total. A total with no prior
 * budget starts at its current value.
 */
export function nextBudgets(totals, budgets = {}, { raise = false } = {}) {
  const out = {};
  for (const key of BUDGETED_TOTALS) {
    const prev = budgets?.[key];
    const current = totals[key];
    out[key] = typeof prev !== "number" || raise ? current : Math.min(prev, current);
  }
  return out;
}

function loadBaseline() {
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    return null;
  }
}

/** Value after a flag: null when the flag is absent, "" when it has no value. */
function flagValue(argv, flag) {
  const i = argv.indexOf(flag);
  if (i === -1) return null;
  const v = argv[i + 1];
  return v && !v.startsWith("--") ? v.trim() : "";
}

/** Totals for every lockfile root other than the platform one. */
function otherRootTotals(gitRef) {
  return LOCKFILE_ROOTS.filter((root) => root.dir !== ".").map((root) => ({
    root,
    totals: generatePlatformSbom({ root: join(ROOT, root.dir), gitRef, generatedAt: new Date(0) }).analysis.totals,
  }));
}

function main() {
  const argv = process.argv.slice(2);
  const update = argv.includes("--update-baseline");
  const raiseReason = flagValue(argv, "--raise-budget");
  if (raiseReason === "") {
    process.stderr.write('::error::--raise-budget needs a reason: --raise-budget "<what the growth retires, or why nothing can>"\n');
    process.exit(1);
  }

  const gitRef = process.env.GITHUB_SHA ?? process.env.GIT_COMMIT ?? "unknown";
  // Fixed timestamp: the drift verdict must depend only on the lockfile,
  // never on wall-clock, so reruns of the same commit are identical.
  const { analysis } = generatePlatformSbom({ root: ROOT, gitRef, generatedAt: new Date(0) });
  const t = analysis.totals;
  const currentDivergent = analysis.firstPartyDivergent.map((d) => d.name).sort();
  const baseline = loadBaseline();

  if (update || raiseReason) {
    const budgets = nextBudgets(t, baseline?.budgets, { raise: Boolean(raiseReason) });
    const lastBudgetRaise = raiseReason ? { reason: raiseReason, budgets } : baseline?.lastBudgetRaise;
    // Each separately resolved lockfile root keeps its own budgets, with the
    // same only-down ratchet (scripts/sbom/lockfile-roots.mjs).
    const roots = {};
    for (const { root, totals } of otherRootTotals(gitRef)) {
      roots[root.id] = {
        lockfile: `${root.dir}/pnpm-lock.yaml`,
        totals,
        budgets: nextBudgets(totals, baseline?.roots?.[root.id]?.budgets, { raise: Boolean(raiseReason) }),
      };
    }
    const next = {
      note: BASELINE_NOTE,
      totals: t,
      budgets,
      ...(lastBudgetRaise ? { lastBudgetRaise } : {}),
      firstPartyDivergent: currentDivergent,
      roots,
    };
    writeFileSync(BASELINE_PATH, JSON.stringify(next, null, 2) + "\n");
    process.stdout.write(
      `Baseline updated: ${BASELINE_PATH}\n  firstPartyDivergent=[${currentDivergent.join(", ")}]\n  budgets=${JSON.stringify(budgets)}\n`,
    );
    return;
  }

  if (!baseline) {
    process.stderr.write(`::error::No SBOM baseline at ${BASELINE_PATH}. Create one with: node scripts/sbom/check-sbom-drift.mjs --update-baseline\n`);
    process.exit(1);
  }

  const accepted = new Set(baseline.firstPartyDivergent ?? []);
  const newDivergent = currentDivergent.filter((n) => !accepted.has(n));
  const resolved = [...accepted].filter((n) => !currentDivergent.includes(n));

  const d = (key) => t[key] - (baseline.totals?.[key] ?? 0);
  const sign = (n) => (n > 0 ? `+${n}` : `${n}`);
  const budgetOf = (key) => (typeof baseline.budgets?.[key] === "number" ? `, budget ${baseline.budgets[key]}` : "");
  process.stdout.write(
    [
      "SBOM dependency-shape report (vs baseline):",
      `  resolved components : ${t.resolvedComponents} (${sign(d("resolvedComponents"))}${budgetOf("resolvedComponents")})`,
      `  duplicated names    : ${t.duplicatedNames} (${sign(d("duplicatedNames"))}${budgetOf("duplicatedNames")})`,
      `  excess instances    : ${t.excessInstances} (${sign(d("excessInstances"))}${budgetOf("excessInstances")})`,
      `  multi-major names   : ${t.multiMajorNames} (${sign(d("multiMajorNames"))}${budgetOf("multiMajorNames")})`,
      `  first-party splits  : ${t.firstPartyDivergentNames} (${sign(d("firstPartyDivergentNames"))})`,
      "",
    ].join("\n"),
  );

  if (resolved.length) {
    process.stdout.write(`Resolved first-party splits (consider ratcheting the baseline down): ${resolved.join(", ")}\n`);
  }

  let failed = false;

  if (newDivergent.length) {
    const detail = analysis.firstPartyDivergent
      .filter((x) => newDivergent.includes(x.name))
      .map((x) => `    - ${x.name}: our declarations resolve to ${x.ourVersions.join(", ")} across ${x.directInWorkspaces.join(", ")}`)
      .join("\n");
    process.stderr.write(
      [
        `::error::New first-party version split introduced: ${newDivergent.join(", ")}`,
        detail,
        "",
        "  A package is now declared at incompatible versions across our own workspaces.",
        "  Fix by aligning the declared specifiers to one major (preferred), or — if the",
        "  split is intentional and unavoidable — accept it:",
        "    node scripts/sbom/check-sbom-drift.mjs --update-baseline",
        "",
      ].join("\n"),
    );
    failed = true;
  }

  const platform = evaluateBudgets(t, baseline.budgets);
  const over = [...platform.over];
  const under = [...platform.under];
  for (const { root, totals } of otherRootTotals(gitRef)) {
    const section = baseline.roots?.[root.id];
    if (!section) {
      process.stderr.write(`::error::sbom/baseline.json has no budgets for lockfile root "${root.id}" (${root.dir}). Add them with --update-baseline.\n`);
      failed = true;
      continue;
    }
    const r = evaluateBudgets(totals, section.budgets);
    process.stdout.write(
      `  ${root.id} lockfile: ${totals.resolvedComponents} components (budget ${section.budgets?.resolvedComponents}), ${totals.duplicatedNames} duplicated names (budget ${section.budgets?.duplicatedNames})\n`,
    );
    over.push(...r.over.map((o) => ({ ...o, key: `${root.id}.${o.key}` })));
    under.push(...r.under.map((u) => ({ ...u, key: `${root.id}.${u.key}` })));
  }
  if (over.length) {
    process.stderr.write(
      [
        `::error::Dependency shape over budget: ${over.map((o) => `${o.key} ${o.current} > ${o.budget}`).join(", ")}`,
        "",
        "  The dependency surface only shrinks (absorb-dont-adopt). Bring the totals back",
        "  under budget with `pnpm dedupe`, by dropping the package, or by retiring what it",
        "  replaces in the same PR. If the growth is deliberate, raise the budget with a",
        "  reason that reviewers see in the diff:",
        '    node scripts/sbom/check-sbom-drift.mjs --raise-budget "<what the growth retires, or why nothing can>"',
        "",
      ].join("\n"),
    );
    failed = true;
  }

  if (failed) process.exit(1);

  if (under.length) {
    process.stdout.write(
      `Under budget (${under.map((u) => `${u.key} ${u.current} < ${u.budget}`).join(", ")}): lock the gain in with --update-baseline.\n`,
    );
  }
  process.stdout.write("OK — no new first-party version splits; dependency shape within budget.\n");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
