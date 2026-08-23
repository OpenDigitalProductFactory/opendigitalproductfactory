import { describe, it, expect } from "vitest";

import { parseApplicability, isRegulationDomain } from "./regulation-applicability";
import { VERTICAL_RECURRING_REGULATIONS } from "./seed-vertical-recurring-compliance";
import { PEOPLE_PREMISES_REGULATIONS } from "./seed-people-premises-compliance";
import { INDUSTRIAL_VERTICAL_REGULATIONS } from "./seed-industrial-vertical-compliance";

// Both archetype pack files are held to the same contract. Enumerated here by
// hand and pinned by a test below: a pack file nobody added to this list would
// ship ungoverned, which is exactly how seed-uk-corp-gov-compliance escaped the
// applicability guard.
const PACK_FILES = [
  ["seed-vertical-recurring-compliance", VERTICAL_RECURRING_REGULATIONS],
  ["seed-people-premises-compliance", PEOPLE_PREMISES_REGULATIONS],
  ["seed-industrial-vertical-compliance", INDUSTRIAL_VERTICAL_REGULATIONS],
] as const;
const ALL_ARCHETYPE_REGULATIONS = PACK_FILES.flatMap(([, regs]) => regs);

describe("archetype recurring-obligation packs", () => {
  it("gates every regulation on at least one archetype", () => {
    // Without an archetype gate the pack falls back to the legacy industry
    // string matcher and surfaces on installs the regime does not apply to —
    // a restaurant's grease-trap duty landing on a software business.
    for (const reg of ALL_ARCHETYPE_REGULATIONS) {
      const parsed = parseApplicability(JSON.parse(JSON.stringify(reg.applicability)));
      expect(parsed, `${reg.regulationId} spec must parse`).not.toBeNull();
      expect(parsed!.archetypes?.length, `${reg.regulationId} must gate on archetypes`).toBeGreaterThan(0);
      expect(parsed!.basis.length).toBeGreaterThan(0);
    }
  });

  it("writes the archetype gate as a source literal the coverage measure can read", () => {
    // scripts/measure-obligation-cadence-coverage.mjs reads the gate from SOURCE.
    // A gate assembled at runtime is invisible to it, and the pack would then
    // report as reaching every install when it does not.
    for (const [file, regs] of PACK_FILES) {
      const src = require("fs").readFileSync(`${__dirname}/${file}.ts`, "utf8");
      for (const reg of regs) {
        for (const archetype of reg.applicability.archetypes ?? []) {
          expect(src, `${archetype} must appear as a literal in ${file}`).toContain(`"${archetype}"`);
        }
      }
    }
  });

  it("attributes every regulation to a real domain and cites an authority", () => {
    for (const reg of ALL_ARCHETYPE_REGULATIONS) {
      expect(isRegulationDomain(reg.domain), `${reg.regulationId} domain`).toBe(true);
      expect(reg.sourceUrl, `${reg.regulationId} must cite an authority`).toMatch(/^https:\/\//);
    }
  });

  it("uses only frequencies the deadline watch can classify", () => {
    // Must stay a subset of what classifyObligationFrequency accepts
    // (apps/web/lib/compliance/obligation-cadence.ts). A word outside it seeds
    // fine and is then reported as uncomputable on every install.
    const known = new Set([
      "monthly", "quarterly", "annual", "biennial", "triennial",
      "continuous", "event-driven",
    ]);
    for (const reg of ALL_ARCHETYPE_REGULATIONS) {
      for (const obl of reg.obligations) {
        expect(known, `${reg.regulationId}/${obl.reference}`).toContain(obl.frequency);
      }
    }
  });

  it("gives every archetype pack at least one REAL recurrence", () => {
    // A pack of purely standing duties leaves the calendar as empty as it was,
    // and the coverage measure refuses to count it.
    for (const reg of ALL_ARCHETYPE_REGULATIONS) {
      const recurring = reg.obligations.filter(
        (o) => !["continuous", "event-driven"].includes(o.frequency),
      );
      expect(recurring.length, `${reg.regulationId} has no recurring obligation`).toBeGreaterThan(0);
    }
  });

  it("states no fee, form number, hour count, or fixed calendar date", () => {
    // Every one of these varies by state and moves between years. A stale
    // specific printed next to a due date reads as authoritative.
    const forbidden = /\$[\d,]|\bForm \b|\b\d+ hours\b|\bFebruary \d|\bJanuary \d|\bApril \d/;
    for (const reg of ALL_ARCHETYPE_REGULATIONS) {
      for (const obl of reg.obligations) {
        const text = `${obl.title} ${obl.description} ${obl.applicability} ${obl.penaltySummary ?? ""}`;
        expect(forbidden.test(text), `${obl.reference} states a volatile specific`).toBe(false);
      }
    }
  });

  it("says out loud, on every varying cadence, that the operator must confirm it", () => {
    // The research is consistent: the DUTY is stable, the CADENCE is not. A row
    // that declares a period without saying it varies invites the operator to
    // trust a date we cannot know.
    const qualifier = /vary|varies|varying|confirm|common|ranging|range|derived|fixed federally|by state/i;
    // Collected, not asserted one at a time: a per-row assertion stops at the
    // first offender and hides the rest, which turns one fix into N rounds.
    const unqualified = ALL_ARCHETYPE_REGULATIONS
      .flatMap((reg) => reg.obligations)
      .filter((obl) => !["continuous", "event-driven"].includes(obl.frequency))
      .filter((obl) => !qualifier.test(obl.applicability))
      .map((obl) => obl.reference);
    expect(unqualified).toEqual([]);
  });

  it("keeps obligation references unique so a re-seed cannot duplicate them", () => {
    const refs = ALL_ARCHETYPE_REGULATIONS.flatMap((r) => r.obligations.map((o) => o.reference));
    expect(new Set(refs).size).toBe(refs.length);
  });
});

describe("every archetype pack file is held to this contract", () => {
  it("enumerates every seed-*-compliance file that gates on archetypes", () => {
    // The failure this prevents: a new pack file lands, nobody adds it to
    // PACK_FILES, and it ships without any of the guards above. That is exactly
    // how seed-uk-corp-gov-compliance escaped the applicability conformance test
    // and reached every install.
    const fs = require("fs") as typeof import("fs");
    const gated = fs.readdirSync(__dirname)
      .filter((f) => /^seed-.*compliance.*\.ts$/.test(f) && !f.includes(".test."))
      .filter((f) => /archetypes:\s*\[/.test(fs.readFileSync(`${__dirname}/${f}`, "utf8")))
      .map((f) => f.replace(/\.ts$/, ""))
      .sort();
    const enumerated = PACK_FILES.map(([file]) => file).sort();
    // Packs predating this contract are listed so the guard catches NEW drift
    // rather than failing on inherited debt.
    const preExisting = [
      "seed-banking-compliance",
      "seed-cooperative-compliance",
      "seed-law-enforcement-compliance",
      "seed-public-sector-compliance",
    ];
    expect(gated.filter((f) => !preExisting.includes(f))).toEqual(enumerated);
  });
});
