#!/usr/bin/env node
// scripts/check-context-economy.mjs
//
// Plane-3 context-economy guard. The runtime-context analog of the instruction-plane
// ratchet (check-instruction-plane-size.mjs) — but DELIBERATELY A DIFFERENT SHAPE.
//
// WHY NOT SHRINK-ONLY. The instruction plane may only shrink, full stop. Copying that
// here would be wrong, and would block exactly the work worth doing: founder doctrine is
// that complexity is acceptable when it removes cognitive load over time ("in time,
// complexity is OK, as this will remove cognitive load long term, so be it"). A monotonic
// shrink-only guard reds the change that spends context now to remove operator load later
// — a false negative on the investment, not a defect caught.
//
// So this guard CANNOT SAY NO. It can only say "say why, on the record". Growth is always
// permitted; growth in silence is not. The teeth are in the recorded justification, which
// persists next to the number it justifies and can be revisited when the promised
// reduction was supposed to arrive.
//
// This mirrors how plane 1 already works: the UX budget runs mostly advisory with blocking
// reserved for surfaces that have no legacy excuse ("Legacy debt earns a ratchet; new code
// has no legacy excuse" — lib/ux-budget/budgets.ts). Hard rules on this platform are
// commandment-tier only (laws, lives); everything else is defeasible by design.
//
// WHAT IT MEASURES — deterministic, from source, no database. CI can never read an
// install's DB, and the assembled prompt is per-turn runtime state, so the honest
// measurable is the STANDING cost the code commits every turn to:
//
//   1. `budgets.<tier>` — the per-model-tier token allowance from context-arbitrator's
//      BUDGETS table. This is the ceiling every turn on that tier is allowed to spend.
//   2. `standingSources` — how many context sources compete for it in the coworker
//      assembly. Each one is a permanent tax on every dispatch, not a per-turn choice.
//
// Per-turn ACTUALS are now recorded by BI-3E218D80 (AgentMessage.contextTrace); this
// guard governs the declared budget, which is the part a PR can change.
//
//   node scripts/check-context-economy.mjs          # check (CI)
//   node scripts/check-context-economy.mjs --update # re-baseline (then write the reasons)

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = join(REPO_ROOT, "scripts", "context-economy-baseline.json");
const ARBITRATOR_REL = "apps/web/lib/tak/context-arbitrator.ts";
const ASSEMBLY_REL = "apps/web/lib/actions/agent-coworker.ts";

// ── Measurement (pure) ──────────────────────────────────────────────────────────

/**
 * Per-tier total token budgets from the BUDGETS table. Parsed rather than imported
 * because this is a .mjs guard and the source is TypeScript — the same approach the
 * other repo guards take.
 */
export function parseTierBudgets(arbitratorSource) {
  const budgets = {};
  const re = /(\w+):\s*\{\s*modelTier:\s*"(\w+)"\s*,\s*totalBudget:\s*(\d+)/g;
  let m;
  while ((m = re.exec(arbitratorSource)) !== null) {
    budgets[m[2]] = Number(m[3]);
  }
  return budgets;
}

/**
 * Distinct standing context-source labels in the coworker assembly. Deduplicated: the
 * question is "how many things claim a share of every turn", not how many times a label
 * is mentioned.
 */
export function parseStandingSources(assemblySource) {
  const labels = new Set();
  const re = /source:\s*"([a-z0-9-]+)"/g;
  let m;
  while ((m = re.exec(assemblySource)) !== null) labels.add(m[1]);
  return [...labels].sort();
}

/** The full measured picture, as flat `key -> number` entries the baseline can hold. */
export function measureContextEconomy({ arbitratorSource, assemblySource }) {
  const budgets = parseTierBudgets(arbitratorSource);
  const sources = parseStandingSources(assemblySource);
  const measured = {};
  for (const [tier, total] of Object.entries(budgets)) {
    measured[`budget.${tier}.totalBudget`] = total;
  }
  measured["assembly.standingSources"] = sources.length;
  return { measured, sources };
}

// ── Evaluation (pure) ───────────────────────────────────────────────────────────

/**
 * @param {object} input
 * @param {Record<string, number>} input.measured        what the tree says now
 * @param {Record<string, {value:number, reason?:string}>} input.baseline  committed baseline (this PR)
 * @param {Record<string, {value:number, reason?:string}>|null} input.baseBaseline  baseline at origin/main
 * @returns {{ok:boolean, errors:string[], notes:string[], justified:string[]}}
 */
export function evaluateContextEconomy({ measured, baseline, baseBaseline }) {
  const errors = [];
  const notes = [];
  const justified = [];

  for (const [key, now] of Object.entries(measured)) {
    const entry = baseline?.[key];
    if (!entry || typeof entry.value !== "number") {
      errors.push(
        `${key} is measured at ${now} but missing from the baseline — run --update, then ` +
          `record a reason for it.`,
      );
      continue;
    }

    // 1. The tree may not exceed what the committed baseline declares.
    if (now > entry.value) {
      errors.push(
        `${key} grew ${entry.value} -> ${now} without re-baselining. Growth is allowed — ` +
          `raise the baseline and record WHY, including what cognitive load it removes ` +
          `and when.`,
      );
      continue;
    }

    // 2. If the baseline itself was RAISED in this change, it must carry a reason.
    //    This is the whole point of the guard: growth in silence is what is forbidden,
    //    not growth.
    const was = baseBaseline?.[key]?.value;
    if (typeof was === "number" && entry.value > was) {
      const reason = typeof entry.reason === "string" ? entry.reason.trim() : "";
      if (reason.length < 20) {
        errors.push(
          `${key} baseline was raised ${was} -> ${entry.value} with no substantive reason. ` +
            `Record what long-term cognitive load this buys — a bare "increased" is the ` +
            `attestation theater this guard exists to prevent.`,
        );
      } else {
        justified.push(`${key} ${was} -> ${entry.value}: ${reason}`);
      }
    }

    // 3. Shrink is always welcome, and worth retightening so the gain is kept.
    if (now < entry.value) {
      notes.push(`${key} is ${now}, below its ${entry.value} baseline — run --update to keep the gain.`);
    }
  }

  return { ok: errors.length === 0, errors, notes, justified };
}

// ── I/O ─────────────────────────────────────────────────────────────────────────

function readBaseline(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8")).entries ?? null;
  } catch {
    return null;
  }
}

function readBaselineAtBase() {
  try {
    const out = execFileSync("git", ["show", "origin/main:scripts/context-economy-baseline.json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return JSON.parse(out).entries ?? null;
  } catch {
    // No base to compare against (new file, shallow clone, detached CI). Rule 2 is then
    // skipped and rule 1 still holds — never fail closed on a missing comparison.
    return null;
  }
}

function main() {
  const arbitratorSource = readFileSync(join(REPO_ROOT, ARBITRATOR_REL), "utf8");
  const assemblySource = readFileSync(join(REPO_ROOT, ASSEMBLY_REL), "utf8");
  const { measured, sources } = measureContextEconomy({ arbitratorSource, assemblySource });

  if (process.argv.includes("--update")) {
    const existing = readBaseline(BASELINE_PATH) ?? {};
    const entries = {};
    for (const [key, value] of Object.entries(measured)) {
      const prior = existing[key];
      entries[key] = {
        value,
        // Carry a prior reason forward only while the number is unchanged; a raised
        // number needs a fresh justification, not an inherited one.
        ...(prior && prior.value === value && prior.reason ? { reason: prior.reason } : {}),
      };
    }
    writeFileSync(
      BASELINE_PATH,
      JSON.stringify(
        {
          _comment:
            "Plane-3 context-economy baseline (scripts/check-context-economy.mjs). Growth is " +
            "ALLOWED but never silent: raise a value and record `reason` saying what long-term " +
            "cognitive load it removes. Shrink freely and re-run --update to keep the gain.",
          standingSources: sources,
          entries,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(`Wrote context-economy baseline: ${Object.keys(entries).length} entries.`);
    console.log("Now add a `reason` to every entry you RAISED — the guard requires it.");
    process.exit(0);
  }

  const baseline = readBaseline(BASELINE_PATH);
  if (!baseline) {
    console.error("Missing scripts/context-economy-baseline.json — run --update to create it.");
    process.exit(1);
  }

  const { ok, errors, notes, justified } = evaluateContextEconomy({
    measured,
    baseline,
    baseBaseline: readBaselineAtBase(),
  });

  for (const j of justified) console.log(`  [recorded] ${j}`);
  for (const n of notes) console.log(`  [note] ${n}`);

  if (!ok) {
    console.error("\nContext-economy guard failed (BI-3E218D80 follow-on).\n");
    for (const e of errors) console.error(`  - ${e}`);
    console.error("");
    console.error("This guard does not forbid growth. Standing context cost may rise when it");
    console.error("buys a durable reduction in cognitive load — that trade is legitimate and");
    console.error("expected. What it forbids is raising the cost SILENTLY, because the claim");
    console.error("has to survive long enough to be checked against what actually happened.");
    console.error("");
    console.error("  node scripts/check-context-economy.mjs --update   # then write the reasons");
    console.error("");
    process.exit(1);
  }

  const budgetSummary = Object.entries(measured)
    .filter(([k]) => k.startsWith("budget."))
    .map(([k, v]) => `${k.split(".")[1]}=${v}`)
    .join(" ");
  console.log(
    `Context-economy OK — ${sources.length} standing sources; budgets ${budgetSummary}.` +
      (justified.length ? ` ${justified.length} recorded increase(s).` : ""),
  );
}

const invokedPath = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
if (invokedPath.endsWith("check-context-economy.mjs")) {
  main();
}
