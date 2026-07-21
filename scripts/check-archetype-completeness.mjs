#!/usr/bin/env node
// Archetype completeness gate — the mechanical half of the archetype
// provisioning playbook (docs/superpowers/specs/2026-07-21-archetype-
// provisioning-playbook-design.md). Coworkers have an enforced conformance gate;
// this is the archetype-side equivalent so a new archetype cannot ship the
// template substrate alone and forget its corpus + coworker (as
// warehousing-fulfilment did before it was backfilled).
//
// Two tiers, split by how universally the dimension is already satisfied so the
// gate never wedges the forward chain on pre-existing debt (same ratchet
// discipline as check-module-size.mjs / check-no-raw-route-error.mjs):
//
//   TIER 1 — structural presence. Every archetype category MUST appear in the
//     category-specific maps a functioning archetype already satisfies. Blocks
//     ALL categories (all pass today).
//
//   TIER 2 — provisioning depth (WSID corpus + a recorded coworker decision).
//     A category NOT in the grandfather baseline (i.e. new, or one since
//     completed) MUST meet the full floor. Pre-existing gaps are frozen in
//     archetype-completeness-baseline.txt and may only shrink.
//
// This file is the IO wrapper; the pure evaluation core lives in
// lib/archetype-completeness.mjs and is unit-tested there.
//
// Usage:
//   node scripts/check-archetype-completeness.mjs            # gate (CI)
//   node scripts/check-archetype-completeness.mjs --report   # full coverage table
//   node scripts/check-archetype-completeness.mjs --update    # regenerate baseline

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import {
  evaluateArchetypeCompleteness,
  categoriesBelowDepthFloor,
} from "./lib/archetype-completeness.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = join(REPO_ROOT, "scripts", "archetype-completeness-baseline.txt");
const DECISIONS_PATH = join(REPO_ROOT, "scripts", "archetype-coworker-decisions.txt");

const rd = (p) => readFileSync(join(REPO_ROOT, p), "utf8");

// PROFESSION_ARCHETYPES (minus "universal") is pinned equal to the categories in
// ALL_ARCHETYPES by the profession-archetype-axis test, so it is the safe
// standalone source of truth for a plain-Node gate (no TS import needed).
function canonicalCategories() {
  const block = rd("packages/db/src/wiki-taxonomy.ts").match(
    /PROFESSION_ARCHETYPES = \[([\s\S]*?)\]/,
  );
  if (!block) throw new Error("could not locate PROFESSION_ARCHETYPES");
  return [...block[1].matchAll(/"([^"]+)"/g)]
    .map((m) => m[1])
    .filter((c) => c !== "universal");
}

function industrySet() {
  return new Set(
    [...rd("apps/web/lib/storefront/industries.ts").matchAll(/value:\s*"([^"]+)"/g)].map(
      (m) => m[1],
    ),
  );
}

function corpusCounts() {
  const counts = {};
  const root = join(REPO_ROOT, "docs", "professions");
  if (!existsSync(root)) return counts;
  for (const prof of readdirSync(root)) {
    const wikiDir = join(root, prof, "wiki");
    if (!existsSync(wikiDir)) continue;
    for (const f of readdirSync(wikiDir)) {
      if (!f.endsWith(".md")) continue;
      const body = readFileSync(join(wikiDir, f), "utf8");
      const fm = body.match(/professionArchetype:\s*\n((?:\s*-\s*[^\n]+\n)+)/);
      if (!fm) continue;
      for (const m of fm[1].matchAll(/-\s*([^\n]+)/g)) {
        const a = m[1].trim();
        counts[a] = (counts[a] || 0) + 1;
      }
    }
  }
  return counts;
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

function softCoverage(categories) {
  const finance = rd("packages/finance-templates/src/profiles.ts");
  const financeSet = new Set(
    [...finance.matchAll(/archetypeCategory:\s*"([^"]+)"/g)].map((m) => m[1]),
  );
  const setup = rd("apps/web/lib/finance/setup-profile.ts");
  const vocab = rd("apps/web/lib/storefront/archetype-vocabulary.ts");
  const playbook = rd("apps/web/lib/tak/marketing-playbooks.ts");
  const bizctx = rd("apps/web/lib/onboarding/archetype-business-context.ts");
  const out = {};
  for (const c of categories) {
    out[c] = {
      financeProfile: financeSet.has(c),
      financeSetupMap: setup.includes(`"${c}"`),
      vocabulary: vocab.includes(`"${c}"`),
      playbook: playbook.includes(`"${c}"`),
      businessContext: bizctx.includes(`"${c}"`),
    };
  }
  return out;
}

function serializeBaseline(cats) {
  const header =
    "# Archetype completeness baseline — categories NOT yet meeting the Tier-2\n" +
    "# provisioning-depth floor (>=1 WSID corpus page AND a recorded coworker\n" +
    "# decision). This list may only SHRINK: a new archetype must meet the floor\n" +
    "# and is never added here; a grandfathered one that gains corpus + a decision\n" +
    "# is removed on the next --update. Do not park new work here.\n";
  return header + [...cats].sort().join("\n") + "\n";
}

// ── Main ─────────────────────────────────────────────────────────────────────
const categories = canonicalCategories();
const corpus = corpusCounts();
const decisions = readLineKeys(DECISIONS_PATH);

if (process.argv.includes("--update")) {
  const failing = categoriesBelowDepthFloor(categories, corpus, decisions);
  writeFileSync(BASELINE_PATH, serializeBaseline(failing));
  console.log(
    `Wrote archetype-completeness baseline: ${failing.length} of ${categories.length} categories below the Tier-2 depth floor (ratchet-down set).`,
  );
  process.exit(0);
}

if (process.argv.includes("--report")) {
  const soft = softCoverage(categories);
  const pad = (s, n) => String(s).padEnd(n);
  const y = (b) => (b ? " Y " : " . ");
  console.log(pad("CATEGORY", 28), "corpus decision | fin setup vocab play bizctx");
  let complete = 0;
  for (const c of categories) {
    const s = soft[c];
    const passes = (corpus[c] || 0) >= 1 && decisions.has(c);
    if (passes) complete++;
    console.log(
      pad(c, 28),
      String(corpus[c] || 0).padStart(4),
      "  ",
      decisions.has(c) ? "  Y   " : "  .   ",
      "|",
      y(s.financeProfile),
      y(s.financeSetupMap),
      y(s.vocabulary),
      y(s.playbook),
      y(s.businessContext),
    );
  }
  console.log(`\n${categories.length} categories; ${complete} meet the full Tier-2 depth floor.`);
  process.exit(0);
}

// Gate mode.
if (!existsSync(BASELINE_PATH)) {
  console.error(
    `Missing baseline ${relative(REPO_ROOT, BASELINE_PATH)} — run: node scripts/check-archetype-completeness.mjs --update`,
  );
  process.exit(1);
}
const baseline = readLineKeys(BASELINE_PATH);
const types = rd("packages/storefront-templates/src/types.ts");
const industry = industrySet();

const result = evaluateArchetypeCompleteness({
  categories,
  inUnion: (c) => types.includes(`"${c}"`),
  inIndustry: (c) => industry.has(c),
  corpusCounts: corpus,
  decisions,
  baseline,
});

if (!result.ok) {
  console.error("Archetype completeness gate FAILED:\n");
  for (const e of result.errors) {
    console.error(
      `  - TIER ${e.tier}: "${e.category}"` +
        (e.tier === 1
          ? ` missing from ${e.missing.join(" + ")}`
          : ` is new (not grandfathered) and must meet the depth floor — missing ${e.missing.join(" + ")}`),
    );
  }
  console.error(
    "\nAdd the missing provisioning. A new archetype must not be added to the grandfather baseline.\n" +
      "Skill: dpf-add-archetype. Spec: docs/superpowers/specs/2026-07-21-archetype-provisioning-playbook-design.md",
  );
  process.exit(1);
}

console.log(
  `Archetype completeness OK — Tier 1 clean for all ${categories.length} categories; ` +
    `${result.completeCount} meet the full Tier-2 depth floor, ${baseline.size} grandfathered gaps ratcheting down.`,
);
if (result.staleBaseline.length > 0) {
  console.log(
    `Ratchet available: ${result.staleBaseline.length} baselined categor${result.staleBaseline.length === 1 ? "y" : "ies"} now pass ` +
      `(${result.staleBaseline.join(", ")}) — run --update to remove them.`,
  );
}
process.exit(0);
