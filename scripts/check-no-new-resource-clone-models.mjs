#!/usr/bin/env node
// Resource-clone ratchet — BI-99C76A90 (Simplify & Strengthen W19,
// architecture pass 2026-08-16 §3.2-c).
//
// The pass found the same scheduling concern modeled four-plus times
// (BeautyResourceAvailability ≡ HospitalityResourceAvailability, two
// *CapacityAllocation ledgers, RecurrenceSchedule AND RecurringSchedule) and
// each new archetype wave adding more clones. The unified family now exists
// (packages/db/prisma/schema/resource-scheduling.prisma): Resource,
// ResourceAvailability, ResourceCapacityPool, ResourceCapacityAllocation,
// discriminated by `domain`, plus the ONE canonical RecurrenceSchedule.
//
// This guard blocks NEW clone-shaped model names — names ending in
// Availability / AvailabilityWindow / CapacityAllocation / CapacityPool /
// RecurrenceSchedule / RecurringSchedule — anywhere in the schema folder
// outside the unified family. The existing clones live in a shrink-only owned
// baseline (scripts/resource-clone-models-baseline.json) until the
// operator-reviewed data migration retires them
// (docs/superpowers/plans/2026-08-18-w19-vertical-clone-collapse-data-migration-plan.md).
//
// A new vertical that needs scheduling joins the unified family (widen the
// ResourceDomain enum) instead of cloning it.
//
//   node scripts/check-no-new-resource-clone-models.mjs            # check (CI)
//   node scripts/check-no-new-resource-clone-models.mjs --update   # retighten

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readPrismaSchemaText } from "./lib/prisma-schema-source.mjs";
import { readJsonBudget, validateBudget } from "./lib/baseline-budget.mjs";
import { isEntryModule } from "./lib/entry-module.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = join(dirname(SCRIPT_PATH), "..");
export const BASELINE_PATH = join(REPO_ROOT, "scripts", "resource-clone-models-baseline.json");

// Clone-shaped name suffixes the W19 unification retires.
export const CLONE_SUFFIX_RE =
  /(Availability|AvailabilityWindow|CapacityAllocation|CapacityPool|RecurrenceSchedule|RecurringSchedule)$/;

// The unified family — the ONLY models allowed to carry these suffixes.
export const UNIFIED_FAMILY = Object.freeze([
  "ResourceAvailability",
  "ResourceCapacityPool",
  "ResourceCapacityAllocation",
  "RecurrenceSchedule", // the one canonical RFC-5545 recurrence primitive
]);

/** All clone-shaped model names in the schema text, unified family excluded. */
export function computeViolations(schemaSource) {
  const out = [];
  for (const m of schemaSource.matchAll(/^model\s+(\w+)\s+\{/gm)) {
    const name = m[1];
    if (!CLONE_SUFFIX_RE.test(name)) continue;
    if (UNIFIED_FAMILY.includes(name)) continue;
    out.push(name);
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
      label: "resource-clone-models-baseline.json",
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
        "Resource-clone model ratchet baseline (BI-99C76A90, pass §3.2-c). Shrink-only: a clone leaves this list when the operator-reviewed W19 data migration retires it — never by expanding the baseline. New scheduling models join the unified resource-scheduling family instead. Regenerate with: node scripts/check-no-new-resource-clone-models.mjs --update",
      entries: computeViolations(schemaSource),
    };
    writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(`Wrote resource-clone model baseline: ${baseline.entries.length} residual clone models.`);
    return;
  }

  let baseline;
  try {
    baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    console.error(
      "Missing/unreadable scripts/resource-clone-models-baseline.json — run: node scripts/check-no-new-resource-clone-models.mjs --update",
    );
    process.exit(1);
  }

  const result = runCheck({ schemaSource, baseline });
  if (result.budgetFailures.length) {
    console.error("Resource-clone model baseline is invalid:");
    for (const f of result.budgetFailures) console.error(`  - ${f}`);
    process.exit(1);
  }

  if (!result.ok) {
    console.error("Resource-clone ratchet failed (BI-99C76A90, pass §3.2-c).\n");
    console.error("NEW clone-shaped scheduling models (join the unified family in");
    console.error("packages/db/prisma/schema/resource-scheduling.prisma — widen the");
    console.error("ResourceDomain enum — instead of cloning it):");
    for (const k of result.ratchet.newViolations) console.error(`  - ${k}`);
    console.error("\nDo not expand the baseline without an owned data-architecture decision.");
    process.exit(1);
  }

  if (result.ratchet.stale.length > 0) {
    console.warn(
      `Resource-clone debt shrank by ${result.ratchet.stale.length} — retighten the baseline in this PR with --update:`,
    );
    for (const k of result.ratchet.stale) console.warn(`  - ${k}`);
  }
  console.log(
    `Resource-clone models OK — ${result.violations.length} residual (budget ${baseline.entries.length}), ` +
      `owner ${baseline.owner}, review by ${baseline.expiry}.`,
  );
}

if (isEntryModule(import.meta.url)) {
  main();
}
