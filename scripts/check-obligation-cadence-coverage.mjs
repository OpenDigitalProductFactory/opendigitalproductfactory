#!/usr/bin/env node
// scripts/check-obligation-cadence-coverage.mjs
//
// Ratchet over archetype obligation coverage.
//
// Two directions, deliberately opposite:
//   categoriesCovered   RISE-ONLY. Coverage is reach to hold. It falls when a
//                       pack loses its archetype gate or its last real
//                       recurrence — both of which leave a pack that still
//                       seeds cleanly and tells the deadline watch nothing.
//   ungatedPacks        SHRINK-ONLY. A pack with no structured applicability
//                       reaches every install regardless of relevance
//                       (BI-9DED0CE8). Known ones are baselined; a NET-NEW one
//                       fails the build.
//
// Adding an archetype is also a coverage regression in the ratio, and that is
// intentional: a new archetype with no obligations reads to its operator as
// "nothing is due", which is indistinguishable from "nothing was entered".
//
// Usage:
//   node scripts/check-obligation-cadence-coverage.mjs           # check
//   node scripts/check-obligation-cadence-coverage.mjs --update  # re-baseline

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT = path.join(REPO_ROOT, "apps", "web", "lib", "compliance", "obligation-cadence-coverage.generated.json");
const BASELINE = path.join(REPO_ROOT, "scripts", "obligation-cadence-baseline.json");

function main() {
  const update = process.argv.includes("--update");
  if (!fs.existsSync(ARTIFACT)) {
    console.error("[obligation-cadence] missing artifact — run: node scripts/measure-obligation-cadence-coverage.mjs");
    process.exit(1);
  }
  const S = JSON.parse(fs.readFileSync(ARTIFACT, "utf8")).summary;
  const prior = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, "utf8")) : null;
  const ungated = [...S.ungatedPacks.packs].sort();

  if (update) {
    if (prior) {
      if (S.categoriesCovered < prior.categoriesCoveredFloor) {
        console.error("[obligation-cadence] refusing --update: covered categories may only RISE.");
        console.error(`  floor ${prior.categoriesCoveredFloor}, now ${S.categoriesCovered}`);
        process.exit(1);
      }
      const netNew = ungated.filter((p) => !prior.ungatedPacks.includes(p));
      if (netNew.length > 0) {
        console.error("[obligation-cadence] refusing --update: the ungated-pack list may only SHRINK.");
        for (const p of netNew) console.error(`  net-new: ${p}`);
        process.exit(1);
      }
    }
    fs.writeFileSync(BASELINE, `${JSON.stringify({
      owner: prior?.owner ?? "platform-governance",
      expiry: prior?.expiry ?? "2026-11-20",
      note:
        "Archetype obligation coverage. categoriesCoveredFloor is RISE-ONLY (reach to hold). "
        + "ungatedPacks is SHRINK-ONLY (debt to burn down): a pack with no structured "
        + "RegulationApplicability surfaces on installs the regime does not pertain to "
        + "(BI-9DED0CE8). Clear an entry by giving the pack a real applicability spec, never by "
        + "deleting the pack.",
      categoriesCoveredFloor: S.categoriesCovered,
      archetypeCategories: S.archetypeCategories,
      ungatedPacks: ungated,
    }, null, 2)}\n`);
    console.log(`[obligation-cadence] baseline updated — floor ${S.categoriesCovered}/${S.archetypeCategories} covered, ${ungated.length} ungated pack(s).`);
    return;
  }

  if (!prior) {
    console.error("[obligation-cadence] no baseline — seed it with --update after reviewing the report.");
    process.exit(1);
  }

  const failures = [];
  if (S.categoriesCovered < prior.categoriesCoveredFloor) {
    failures.push(
      `archetype coverage FELL: ${S.categoriesCovered} covered, floor is ${prior.categoriesCoveredFloor}.`,
      "  A category stops counting when its pack loses its archetype gate or its last real",
      "  recurrence. Both leave a pack that seeds cleanly and tells the deadline watch nothing.",
    );
  }
  const netNew = ungated.filter((p) => !prior.ungatedPacks.includes(p));
  if (netNew.length > 0) {
    failures.push(
      `${netNew.length} NET-NEW pack(s) with no structured applicability:`,
      ...netNew.map((p) => `    ${p}`),
      "  Without a spec the pack falls back to the legacy industry string matcher and surfaces",
      "  on installs the regime does not pertain to. Give it a RegulationApplicability with an",
      "  archetype, jurisdiction, or data-handling gate.",
    );
  }

  if (failures.length > 0) {
    console.error("[obligation-cadence] FAILED\n");
    for (const line of failures) console.error(`  ${line}`);
    console.error("");
    process.exit(1);
  }

  console.log(
    `[obligation-cadence] ok — ${S.categoriesCovered}/${S.archetypeCategories} categories covered `
    + `(floor ${prior.categoriesCoveredFloor}), ${ungated.length} ungated pack(s) within baseline.`,
  );
  if (S.categoriesCovered > prior.categoriesCoveredFloor) {
    console.log(`  coverage rose (${prior.categoriesCoveredFloor} -> ${S.categoriesCovered}) — run --update to ratchet up.`);
  }
  const cleared = prior.ungatedPacks.filter((p) => !ungated.includes(p));
  if (cleared.length > 0) {
    console.log(`  ${cleared.length} ungated pack(s) now specified — run --update to ratchet down.`);
  }
}

main();
