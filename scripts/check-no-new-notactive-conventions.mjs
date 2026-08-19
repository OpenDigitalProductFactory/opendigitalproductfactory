#!/usr/bin/env node
// "Not active" convention ratchet — BI-C357FA5A (Simplify & Strengthen W20,
// architecture pass 2026-08-16 §3.2-d).
//
// The pass found "not active" said six ways — archivedAt, supersededById,
// mergedIntoId, quarantinedAt/overlapQuarantinedAt/conflictQuarantinedAt,
// retiredAt, status="quarantined" — so every reader must know which convention
// applies per table: a correctness-bug factory. The ONE convention is now
// defined (docs/architecture/data-model-stewardship-runbook.md §"Record
// lifecycle convention"): `lifecycle RecordLifecycle` + `lifecycleAt`
// (+ optional `lifecycleReason`, + a DECLARED successor self-relation where a
// family needs supersede/merge chains). Pilot family: the W19 unified
// resource-scheduling models, born on the convention.
//
// This guard blocks NEW legacy-convention columns anywhere in the schema
// folder:
//   - archivedAt / retiredAt
//   - *quarantinedAt (any casing prefix: quarantinedAt, overlapQuarantinedAt,
//     conflictQuarantinedAt, ...)
//   - supersededBy*Id (supersededById, supersededByScheduleId, ...)
//   - mergedIntoId
// The sixth convention (a String status carrying "quarantined") cannot gain
// new columns anyway: check-no-new-closed-set-strings.mjs blocks new
// closed-set String columns, and the RecordLifecycle enum is the sanctioned
// replacement.
//
// Existing carriers live in a shrink-only owned baseline
// (scripts/notactive-conventions-baseline.json) until the operator-reviewed
// migration (docs/superpowers/plans/2026-08-18-w20-lifecycle-convention-migration-plan.md).
//
//   node scripts/check-no-new-notactive-conventions.mjs            # check (CI)
//   node scripts/check-no-new-notactive-conventions.mjs --update   # retighten

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readPrismaSchemaText } from "./lib/prisma-schema-source.mjs";
import { readJsonBudget, validateBudget } from "./lib/baseline-budget.mjs";
import { isEntryModule } from "./lib/entry-module.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = join(dirname(SCRIPT_PATH), "..");
export const BASELINE_PATH = join(REPO_ROOT, "scripts", "notactive-conventions-baseline.json");

// Legacy "not active" column shapes (§3.2-d). Order matters only for reporting.
export const LEGACY_CONVENTION_RES = Object.freeze([
  /^archivedAt$/,
  /^retiredAt$/,
  /^\w*[qQ]uarantinedAt$/,
  /^supersededBy\w*Id$/,
  /^mergedIntoId$/,
]);

export function isLegacyConventionField(name) {
  return LEGACY_CONVENTION_RES.some((re) => re.test(name));
}

/** All legacy-convention columns in the schema text, as sorted "Model.field" keys. */
export function computeViolations(schemaSource) {
  const out = [];
  const modelRe = /^model\s+(\w+)\s+\{([\s\S]*?)^\}/gm;
  let match;
  while ((match = modelRe.exec(schemaSource))) {
    const [, modelName, body] = match;
    for (const raw of body.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("//") || line.startsWith("@@")) continue;
      const field = line.match(/^(\w+)\s+[A-Za-z_]\w*/);
      if (!field) continue;
      if (isLegacyConventionField(field[1])) out.push(`${modelName}.${field[1]}`);
    }
  }
  return out.sort();
}

export function evaluateRatchet(current, baselined) {
  const baseSet = new Set(baselined);
  const currentSet = new Set(current);
  return {
    newViolations: current.filter((k) => !baseSet.has(k)),
    stale: baselined.filter((k) => !currentSet.has(k)),
  };
}

export function runCheck({ schemaSource, baseline, today }) {
  const violations = computeViolations(schemaSource);
  const budgetFailures = [
    ...validateBudget(readJsonBudget(baseline), {
      label: "notactive-conventions-baseline.json",
      ...(today ? { today } : {}),
    }),
    ...(Array.isArray(baseline?.entries) ? [] : ["Baseline entries must be an array."]),
  ];
  if (budgetFailures.length) return { ok: false, budgetFailures, violations };
  const ratchet = evaluateRatchet(violations, baseline.entries);
  return { ok: ratchet.newViolations.length === 0, budgetFailures: [], violations, ratchet };
}

function main() {
  const schemaSource = readPrismaSchemaText(REPO_ROOT);

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
    const baseline = {
      version: 1,
      owner,
      expiry,
      note:
        "Not-active convention ratchet baseline (BI-C357FA5A, pass §3.2-d). Shrink-only: a column leaves this list by migrating to the RecordLifecycle convention (operator-reviewed W20 plan), never by expanding the baseline. New models use `lifecycle RecordLifecycle` + `lifecycleAt`. Regenerate with: node scripts/check-no-new-notactive-conventions.mjs --update",
      entries: computeViolations(schemaSource),
    };
    writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(`Wrote not-active convention baseline: ${baseline.entries.length} residual columns.`);
    return;
  }

  let baseline;
  try {
    baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    console.error(
      "Missing/unreadable scripts/notactive-conventions-baseline.json — run: node scripts/check-no-new-notactive-conventions.mjs --update",
    );
    process.exit(1);
  }

  const result = runCheck({ schemaSource, baseline });
  if (result.budgetFailures.length) {
    console.error("Not-active convention baseline is invalid:");
    for (const f of result.budgetFailures) console.error(`  - ${f}`);
    process.exit(1);
  }

  if (!result.ok) {
    console.error("Not-active convention ratchet failed (BI-C357FA5A, pass §3.2-d).\n");
    console.error("NEW legacy not-active columns (use the ONE record lifecycle convention");
    console.error("instead — `lifecycle RecordLifecycle` + `lifecycleAt`, see");
    console.error('docs/architecture/data-model-stewardship-runbook.md §"Record lifecycle convention"):');
    for (const k of result.ratchet.newViolations) console.error(`  - ${k}`);
    console.error("\nDo not expand the baseline without an owned data-architecture decision.");
    process.exit(1);
  }

  if (result.ratchet.stale.length > 0) {
    console.warn(
      `Not-active convention debt shrank by ${result.ratchet.stale.length} — retighten the baseline in this PR with --update:`,
    );
    for (const k of result.ratchet.stale) console.warn(`  - ${k}`);
  }
  console.log(
    `Not-active conventions OK — ${result.violations.length} residual (budget ${baseline.entries.length}), ` +
      `owner ${baseline.owner}, review by ${baseline.expiry}.`,
  );
}

if (isEntryModule(import.meta.url)) {
  main();
}
