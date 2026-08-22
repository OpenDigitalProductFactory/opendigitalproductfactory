#!/usr/bin/env node
// scripts/measure-obligation-cadence-coverage.mjs
//
// Does every business archetype this platform can install as have its recurring
// obligations declared — and do those obligations carry a recurrence something
// can actually compute a date from?
//
// TAK §8.11.1: a recorded intention with no reader is a defect, not latent
// configuration. This measure covers the case one step earlier — an archetype
// with NO recorded obligations at all. That reads to an operator as "nothing is
// due", which is indistinguishable on screen from "nothing was ever entered",
// and is the more dangerous of the two because no finding is ever raised.
//
// Source-derived, like the capability measure: it parses the archetype
// definitions and the compliance seed packs rather than reading a database, so
// the number is reproducible in CI on a fresh clone.
//
// Two axes, deliberately separate:
//   COMMON     obligations that apply to a business whatever it does. An install
//              of any archetype should inherit these.
//   ARCHETYPE  obligations that exist because of what this business IS.
//
// An archetype with common coverage and no archetype pack is NOT complete: the
// point of the archetype axis is the obligations a generic pack cannot know.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const P = (...parts) => path.join(REPO_ROOT, ...parts);

// Mirrors classifyObligationFrequency in
// apps/web/lib/compliance/obligation-cadence.ts. A conformance test pins the two
// in lockstep — a word this file computes and the runtime does not (or vice
// versa) would make the measure disagree with the sweep it reports on.
export const CADENCE_WORDS = new Set([
  "daily", "weekly", "biweekly", "fortnightly", "monthly", "bimonthly", "quarterly",
  "semi-annual", "semiannual", "half-yearly", "biannual", "annual", "annually",
  "yearly", "biennial", "triennial",
]);
const CONTINUOUS_WORDS = new Set(["continuous", "continual", "ongoing", "standing", "always"]);
const EVENT_WORDS = new Set([
  "event-driven", "event driven", "on-event", "as-needed", "as needed",
  "on-request", "on request", "ad-hoc", "ad hoc",
]);

export function classifyFrequency(word) {
  if (typeof word !== "string" || !word.trim()) return "unspecified";
  const n = word.trim().toLowerCase();
  if (CADENCE_WORDS.has(n)) return "cadence";
  if (CONTINUOUS_WORDS.has(n)) return "continuous";
  if (EVENT_WORDS.has(n)) return "event-driven";
  return "unrecognised";
}

/** Every archetype the platform can be installed as, grouped by category. */
export function readArchetypes(dir = P("packages", "storefront-templates", "src", "archetypes")) {
  const byCategory = new Map();
  if (!fs.existsSync(dir)) return byCategory;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".ts") || file.includes(".test.")) continue;
    const src = fs.readFileSync(path.join(dir, file), "utf8");
    // archetypeId and category always appear together in a definition literal.
    const re = /archetypeId:\s*"([a-z0-9-]+)"[\s\S]{0,400}?category:\s*"([a-z0-9-]+)"/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      if (!byCategory.has(m[2])) byCategory.set(m[2], new Set());
      byCategory.get(m[2]).add(m[1]);
    }
  }
  return byCategory;
}

/**
 * The seeded compliance packs, with the archetypes each gates on and the
 * trigger-class breakdown of its obligations. A pack with NO archetype gate is
 * horizontal — it applies to every install — and counts toward COMMON.
 */
export function readCompliancePacks(dir = P("packages", "db", "src")) {
  const packs = [];
  if (!fs.existsSync(dir)) return packs;
  // Shared applicability constants live here; a pack may import one instead of
  // writing the spec inline.
  const applicabilityModule = fs.existsSync(path.join(dir, "regulation-applicability.ts"))
    ? fs.readFileSync(path.join(dir, "regulation-applicability.ts"), "utf8")
    : "";
  for (const file of fs.readdirSync(dir)) {
    if (!/^seed-.*compliance.*\.ts$/.test(file) || file.includes(".test.")) continue;
    const src = fs.readFileSync(path.join(dir, file), "utf8");
    const gated = new Set(
      [...src.matchAll(/archetypes:\s*\[([^\]]*)\]/g)]
        .flatMap((m) => [...m[1].matchAll(/"([a-z0-9-]+)"/g)].map((x) => x[1])),
    );
    // A pack with NO structured RegulationApplicability falls back to the legacy
    // industry string matcher and surfaces on installs the regime does not
    // pertain to (BI-9DED0CE8). That is not "common" — it is ungoverned.
    //
    // A spec counts whether it is written inline OR imported as a shared
    // constant. The first cut of this check looked only for an inline
    // `basis: [` and reported seed-uk-corp-gov-compliance as ungated — it is
    // not: it uses UK_CORP_GOV_CODE_APPLICABILITY from regulation-applicability.ts
    // and is gated on jurisdiction AND premium listing status. A measure that
    // invents a defect is the same failure as one that hides a real one, and it
    // is worse here because someone would have "fixed" a pack that was correct.
    const sharedSpecs = new Set(
      [...applicabilityModule.matchAll(/export const ([A-Z0-9_]+_APPLICABILITY)[^=]*=\s*\{[^}]*basis:\s*\[/g)]
        .map((m) => m[1]),
    );
    const usesSharedSpec = [...sharedSpecs].some((name) => new RegExp(`\\b${name}\\b`).test(src));
    const hasStructuredSpec = /\bbasis:\s*\[/.test(src) || usesSharedSpec;
    const gatesOnJurisdiction = /\bjurisdictions:\s*\[/.test(src);
    const gatesOnDataHandling = /\bdataHandling:\s*\[/.test(src);
    const byClass = { cadence: 0, continuous: 0, "event-driven": 0, unrecognised: 0, unspecified: 0 };
    for (const m of src.matchAll(/frequency:\s*"([^"]*)"/g)) byClass[classifyFrequency(m[1])] += 1;
    const obligations = Object.values(byClass).reduce((a, b) => a + b, 0);
    if (obligations === 0) continue;
    packs.push({
      pack: file.replace(/^seed-|\.ts$/g, ""),
      file: `packages/db/src/${file}`,
      // archetype  — scoped to what the business IS
      // conditional— universal in principle, gated by jurisdiction or by what
      //              the business DOES with data (e.g. CCPA on any US business
      //              that processes personal data)
      // ungated    — no structured spec at all; reaches every install
      scope: gated.size > 0 ? "archetype" : hasStructuredSpec ? "conditional" : "ungated",
      gatesOn: [...gated].sort(),
      gatesOnJurisdiction,
      gatesOnDataHandling,
      hasStructuredSpec,
      obligations,
      byTriggerClass: byClass,
    });
  }
  return packs.sort((a, b) => a.pack.localeCompare(b.pack));
}

export function buildReport({ byCategory, packs }) {
  const common = packs.filter((p) => p.scope === "conditional");
  const ungated = packs.filter((p) => p.scope === "ungated");
  const archetypePacks = packs.filter((p) => p.scope === "archetype");

  const commonObligations = common.reduce((n, p) => n + p.obligations, 0);
  const commonRecurring = common.reduce((n, p) => n + p.byTriggerClass.cadence, 0);

  const categories = [...byCategory.keys()].sort().map((category) => {
    const archetypeIds = [...byCategory.get(category)].sort();
    // A pack covers a category if it gates on the category slug itself or on
    // any archetype inside it.
    const covering = archetypePacks.filter(
      (p) => p.gatesOn.includes(category) || p.gatesOn.some((g) => archetypeIds.includes(g)),
    );
    const recurring = covering.reduce((n, p) => n + p.byTriggerClass.cadence, 0);
    const obligations = covering.reduce((n, p) => n + p.obligations, 0);
    return {
      category,
      archetypes: archetypeIds.length,
      packs: covering.map((p) => p.pack),
      obligations,
      recurringObligations: recurring,
      // Complete = an archetype pack exists AND at least one of its obligations
      // is a real recurrence. A pack of purely continuous duties tells the
      // deadline watch nothing and leaves the calendar empty.
      status: covering.length === 0 ? "no-pack" : recurring === 0 ? "no-recurring" : "covered",
    };
  });

  const covered = categories.filter((c) => c.status === "covered");
  return {
    generatedBy: "scripts/measure-obligation-cadence-coverage.mjs",
    summary: {
      archetypeCategories: categories.length,
      archetypes: categories.reduce((n, c) => n + c.archetypes, 0),
      categoriesCovered: covered.length,
      categoriesWithoutPack: categories.filter((c) => c.status === "no-pack").length,
      categoriesWithoutRecurring: categories.filter((c) => c.status === "no-recurring").length,
      coveragePct: categories.length === 0 ? 0 : Math.round((covered.length / categories.length) * 100),
      common: {
        packs: common.map((p) => p.pack),
        obligations: commonObligations,
        recurringObligations: commonRecurring,
        note:
          "Obligations that apply whatever the business IS, gated instead by jurisdiction or by "
          + "what it DOES with data. Every qualifying install inherits these; they do NOT "
          + "substitute for an archetype pack, whose whole purpose is what a generic pack "
          + "cannot know.",
      },
      ungatedPacks: {
        packs: ungated.map((p) => p.pack),
        obligations: ungated.reduce((n, p) => n + p.obligations, 0),
        note:
          "DEFECT, not coverage. A pack with no structured RegulationApplicability falls back to "
          + "the legacy industry string matcher (BI-9DED0CE8) and surfaces on installs the regime "
          + "does not pertain to. It is not common — it is addressed to everyone.",
      },
      triggerClasses: packs.reduce((acc, p) => {
        for (const [k, v] of Object.entries(p.byTriggerClass)) acc[k] = (acc[k] ?? 0) + v;
        return acc;
      }, {}),
      note:
        "An archetype with no obligations reads to an operator as 'nothing is due', which is "
        + "indistinguishable from 'nothing was ever entered' — and raises no finding, so nobody "
        + "is told. Source-derived from the archetype definitions and the compliance seed packs.",
    },
    packs,
    categories,
  };
}

export function renderMarkdown(report) {
  const S = report.summary;
  const L = [];
  L.push("---", 'title: "Obligation Cadence Coverage"', "area: maintenance", "---", "");
  L.push("# Obligation Cadence Coverage", "");
  L.push(`<!-- GENERATED by ${report.generatedBy} — do not edit by hand. -->`, "");
  L.push(
    "Every archetype this platform can be installed as, and whether its recurring",
    "obligations are declared. An archetype with no obligations reads as *nothing is",
    "due*, which looks identical to *nothing was ever entered* — and raises no",
    "finding, so nobody is told.",
    "",
  );
  if (S.ungatedPacks.packs.length > 0) {
    L.push("## Ungated packs — a defect, not coverage", "");
    L.push(
      "These carry no structured applicability spec, so they fall back to the legacy",
      "industry string matcher and can surface on an install the regime does not apply",
      "to. They are not common; they are addressed to everyone.",
      "",
    );
    for (const p of S.ungatedPacks.packs) L.push(`- \`${p}\``);
    L.push("", `Obligations reaching every install this way: **${S.ungatedPacks.obligations}**`, "");
  }
  L.push("## Common — applies whatever the business IS", "");
  L.push(`- Packs: ${S.common.packs.map((p) => `\`${p}\``).join(", ") || "_none_"}`);
  L.push(`- Obligations: **${S.common.obligations}**, of which **${S.common.recurringObligations}** recur on a computable cadence`, "");
  L.push("## Archetype coverage", "");
  L.push(`- Archetype categories: **${S.archetypeCategories}** (over ${S.archetypes} archetypes)`);
  L.push(`- Covered (a pack AND at least one real recurrence): **${S.categoriesCovered}** (${S.coveragePct}%)`);
  L.push(`- No pack at all: **${S.categoriesWithoutPack}**`);
  L.push(`- Pack, but nothing recurring: **${S.categoriesWithoutRecurring}**`, "");
  L.push("| Category | Archetypes | Packs | Obligations | Recurring | Status |");
  L.push("|---|---:|---|---:|---:|---|");
  for (const c of report.categories) {
    const mark = c.status === "covered" ? "covered" : c.status === "no-recurring" ? "**no recurring**" : "**NO PACK**";
    L.push(`| \`${c.category}\` | ${c.archetypes} | ${c.packs.join(", ") || "—" } | ${c.obligations} | ${c.recurringObligations} | ${mark} |`);
  }
  L.push("", "## Trigger classes across every pack", "");
  L.push("| Class | Obligations |", "|---|---:|");
  for (const [k, v] of Object.entries(S.triggerClasses).sort((a, b) => b[1] - a[1])) {
    L.push(`| \`${k}\` | ${v} |`);
  }
  L.push(
    "",
    "`cadence` is the only class the deadline-horizon watch can act on. `continuous`",
    "and `event-driven` are correctly dateless and are NOT defects.",
    "",
  );
  return `${L.join("\n")}\n`;
}

function main() {
  const report = buildReport({ byCategory: readArchetypes(), packs: readCompliancePacks() });
  const jsonPath = P("apps", "web", "lib", "compliance", "obligation-cadence-coverage.generated.json");
  const mdPath = P("docs", "maintenance", "obligation-cadence-coverage.md");
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const md = renderMarkdown(report);

  // --check: the derived-artifacts gate asks whether the committed artifact
  // still matches its sources, without writing.
  if (process.argv.includes("--check")) {
    const stale = [
      [jsonPath, json],
      [mdPath, md],
    ].filter(([file, expected]) => !fs.existsSync(file) || fs.readFileSync(file, "utf8") !== expected);
    if (stale.length > 0) {
      console.error("[obligation-cadence] derived artifact is stale — run: pnpm measure:obligation-cadence");
      for (const [file] of stale) console.error(`  ${path.relative(REPO_ROOT, file)}`);
      process.exit(1);
    }
    console.log("[obligation-cadence] derived artifacts are fresh.");
    return;
  }

  fs.writeFileSync(jsonPath, json);
  fs.writeFileSync(mdPath, md);
  const S = report.summary;
  console.log(`Obligation cadence coverage — ${S.archetypeCategories} archetype categories (${S.archetypes} archetypes)`);
  console.log(`  covered            ${S.categoriesCovered} (${S.coveragePct}%)`);
  console.log(`  no pack at all     ${S.categoriesWithoutPack}`);
  console.log(`  pack, no recurring ${S.categoriesWithoutRecurring}`);
  console.log(`  common             ${S.common.obligations} obligations, ${S.common.recurringObligations} recurring`);
  console.log(`  UNGATED packs      ${S.ungatedPacks.packs.length} (${S.ungatedPacks.obligations} obligations reach every install)`);
  console.log(`  trigger classes    ${JSON.stringify(S.triggerClasses)}`);
  console.log(`\nWrote ${path.relative(REPO_ROOT, jsonPath)}`);
  console.log(`Wrote ${path.relative(REPO_ROOT, mdPath)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
