#!/usr/bin/env node
// Stewardship-scope drift gate (BI-C34E09B0) — a new Prisma model must declare
// how it is stewarded, instead of being silently enrolled in wrong defaults.
//
// Operator framing (founder, 2026-07-20): "new data tables to manage need
// stewardship scope to increase; this should be largely automated — in most
// real orgs today it is highly disconnected." DPF reproduced that disconnect
// mechanically. This gate converts a silent omission into a forced decision.
//
// Two tiers, same ratchet discipline as check-archetype-completeness.mjs /
// check-module-size.mjs so the gate never wedges the forward chain on
// pre-existing debt:
//
//   INTEGRITY — dangling registry entries, unknown exemption reasons, and
//     models claiming two dispositions. Never grandfathered; always block.
//
//   COVERAGE — every persistent model needs a TABLE_CLASSIFICATION entry AND
//     exactly one retention disposition (purge policy | retained dataset |
//     declared exemption). A model NOT in the grandfather baseline must meet
//     the floor. Pre-existing gaps are frozen in
//     scripts/stewardship-scope-baseline.txt and may only shrink.
//
// This file is the IO wrapper; the pure evaluation core lives in
// lib/stewardship-scope.mjs and is unit-tested there.
//
// Usage:
//   node scripts/check-stewardship-scope.mjs            # gate (CI)
//   node scripts/check-stewardship-scope.mjs --report   # coverage summary
//   node scripts/check-stewardship-scope.mjs --update   # regenerate baseline

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import {
  evaluateStewardshipScope,
  modelsBelowStewardshipFloor,
  delegateFor,
  EXEMPTION_REASONS,
} from "./lib/stewardship-scope.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = join(REPO_ROOT, "scripts", "stewardship-scope-baseline.txt");
const EXEMPTIONS_PATH = join(REPO_ROOT, "scripts", "stewardship-exemptions.txt");

const SCHEMA_PATH = "packages/db/prisma/schema.prisma";
const CLASSIFICATION_PATH = "packages/db/src/table-classification.ts";
const POLICIES_PATH = "apps/web/lib/operate/retention/policies.ts";

const rd = (p) => readFileSync(join(REPO_ROOT, p), "utf8");

// ── Source readers ───────────────────────────────────────────────────────────
// Plain-text parsing (no TS import) so the gate runs under bare Node in CI with
// no build step — the same constraint check-archetype-completeness.mjs works
// under.

/** Persistent Prisma models. `view` blocks and @@ignore'd models are not
 *  tables the platform stewards, so they are excluded. */
function persistentModels(schemaSource) {
  const out = [];
  const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m;
  while ((m = re.exec(schemaSource)) !== null) {
    if (/@@ignore\b/.test(m[2])) continue;
    out.push(m[1]);
  }
  return out;
}

/** Model names present in TABLE_CLASSIFICATION. */
function classifiedModels(source) {
  const body = source.match(
    /TABLE_CLASSIFICATION[^=]*=\s*\{([\s\S]*?)^\};/m,
  );
  if (!body) throw new Error(`could not locate TABLE_CLASSIFICATION in ${CLASSIFICATION_PATH}`);
  return new Set(
    [...body[1].matchAll(/^\s*(\w+):\s*"(?:public|internal|confidential|restricted)"/gm)].map(
      (x) => x[1],
    ),
  );
}

/** Delegate accessors named by a `model: "..."` entry inside one registry array. */
function registryModels(source, constName) {
  const body = source.match(
    new RegExp(`${constName}[^=]*=\\s*\\[([\\s\\S]*?)^\\] as const;`, "m"),
  );
  if (!body) throw new Error(`could not locate ${constName} in ${POLICIES_PATH}`);
  return new Set([...body[1].matchAll(/\bmodel:\s*"([^"]+)"/g)].map((x) => x[1]));
}

/** Declared exemptions: `ModelName  reason-slug  # optional note`. */
function readExemptions(path) {
  const map = new Map();
  if (!existsSync(path)) return map;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const [model, reason] = line.split(/\s+/);
    map.set(model, reason ?? "");
  }
  return map;
}

function readLineKeys(path) {
  const set = new Set();
  if (!existsSync(path)) return set;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    set.add(line.split(/\s+/)[0]);
  }
  return set;
}

function serializeBaseline(models) {
  const header =
    "# Stewardship-scope baseline (BI-C34E09B0) — persistent Prisma models that do\n" +
    "# NOT yet declare both a data classification and a retention disposition.\n" +
    "#\n" +
    "# This list may only SHRINK. A NEW model must declare its stewardship and is\n" +
    "# never added here; a grandfathered one that gains both is removed on the next\n" +
    "# --update. Do not park new work here.\n" +
    "#\n" +
    "# To clear an entry, give the model BOTH:\n" +
    "#   1. a sensitivity in packages/db/src/table-classification.ts, and\n" +
    "#   2. exactly one of: a PURGE_POLICIES entry, a RETAINED_DATASETS entry (with\n" +
    "#      a cited regulatory basis), or a line in scripts/stewardship-exemptions.txt.\n";
  return header + [...models].sort().join("\n") + "\n";
}

// ── Load ─────────────────────────────────────────────────────────────────────
const policiesSource = rd(POLICIES_PATH);
const input = {
  models: persistentModels(rd(SCHEMA_PATH)),
  classified: classifiedModels(rd(CLASSIFICATION_PATH)),
  purgeModels: registryModels(policiesSource, "PURGE_POLICIES"),
  retainedModels: registryModels(policiesSource, "RETAINED_DATASETS"),
  exemptions: readExemptions(EXEMPTIONS_PATH),
  baseline: readLineKeys(BASELINE_PATH),
};

// ── Modes ────────────────────────────────────────────────────────────────────
if (process.argv.includes("--update")) {
  const below = modelsBelowStewardshipFloor(input);
  writeFileSync(BASELINE_PATH, serializeBaseline(below));
  console.log(
    `Wrote stewardship-scope baseline: ${below.length} of ${input.models.length} models below the floor (ratchet-down set).`,
  );
  process.exit(0);
}

if (process.argv.includes("--report")) {
  const r = evaluateStewardshipScope(input);
  const n = input.models.length;
  const pct = (x) => `${((x / n) * 100).toFixed(1)}%`;
  console.log(`Persistent Prisma models: ${n}`);
  console.log(`  classified (TABLE_CLASSIFICATION): ${r.classifiedCount} (${pct(r.classifiedCount)})`);
  console.log(`  retention disposition declared:    ${r.dispositionCount} (${pct(r.dispositionCount)})`);
  console.log(`    - purge policy:        ${input.purgeModels.size}`);
  console.log(`    - retained dataset:    ${input.retainedModels.size}`);
  console.log(`    - declared exemption:  ${input.exemptions.size}`);
  console.log(`  fully stewarded (both):            ${r.completeCount} (${pct(r.completeCount)})`);
  console.log(`  grandfathered in baseline:         ${input.baseline.size}`);
  const missingBoth = input.models.filter(
    (m) => !r.coverage[m].hasClassification && !r.coverage[m].hasDisposition,
  );
  console.log(`  missing BOTH axes:                 ${missingBoth.length}`);
  process.exit(0);
}

// Gate mode.
if (!existsSync(BASELINE_PATH)) {
  console.error(
    `Missing baseline ${relative(REPO_ROOT, BASELINE_PATH)} — run: node scripts/check-stewardship-scope.mjs --update`,
  );
  process.exit(1);
}

const result = evaluateStewardshipScope(input);

if (!result.ok) {
  console.error("Stewardship-scope gate FAILED:\n");
  for (const e of result.errors) {
    if (e.kind === "unstewarded-model") {
      console.error(`  - ${e.model} (delegate: ${delegateFor(e.model)}) ${e.detail}`);
      for (const miss of e.missing) console.error(`      missing: ${miss}`);
    } else {
      console.error(`  - [${e.kind}] ${e.model}: ${e.detail}`);
    }
  }
  console.error(
    "\nA new persistent model must declare BOTH a data classification and exactly one\n" +
      "retention disposition. Absence is not a decision — left alone the model is\n" +
      `classified "confidential" by fallback and never swept, silently, forever.\n\n` +
      `  1. classification -> ${CLASSIFICATION_PATH}\n` +
      `  2. disposition    -> ${POLICIES_PATH} (PURGE_POLICIES or RETAINED_DATASETS)\n` +
      `                       or scripts/stewardship-exemptions.txt when neither applies\n` +
      `                       (reasons: ${EXEMPTION_REASONS.join(" | ")})\n\n` +
      "Do NOT invent a purge window to clear this gate: the retention engine EXECUTES\n" +
      "PURGE_POLICIES, so a fabricated window on reference data deletes it. Declare an\n" +
      "exemption instead. A new model must not be added to the grandfather baseline.",
  );
  process.exit(1);
}

console.log(
  `Stewardship scope OK — integrity clean across ${input.models.length} persistent models; ` +
    `${result.completeCount} fully stewarded, ${input.baseline.size} grandfathered gaps ratcheting down.`,
);
if (result.staleBaseline.length > 0) {
  console.log(
    `Ratchet available: ${result.staleBaseline.length} baselined model(s) now pass ` +
      `(${result.staleBaseline.slice(0, 10).join(", ")}${result.staleBaseline.length > 10 ? ", …" : ""}) — run --update to remove them.`,
  );
}
if (result.orphanBaseline.length > 0) {
  console.log(
    `Ratchet available: ${result.orphanBaseline.length} baselined model(s) no longer exist ` +
      `(${result.orphanBaseline.slice(0, 10).join(", ")}${result.orphanBaseline.length > 10 ? ", …" : ""}) — run --update to remove them.`,
  );
}
process.exit(0);
