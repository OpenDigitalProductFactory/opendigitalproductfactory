import { describe, it, expect } from "vitest";

import { parseApplicability, isRegulationDomain } from "./regulation-applicability";
import { VERTICAL_RECURRING_REGULATIONS } from "./seed-vertical-recurring-compliance";

describe("archetype recurring-obligation packs", () => {
  it("gates every regulation on at least one archetype", () => {
    // Without an archetype gate the pack falls back to the legacy industry
    // string matcher and surfaces on installs the regime does not apply to —
    // a restaurant's grease-trap duty landing on a software business.
    for (const reg of VERTICAL_RECURRING_REGULATIONS) {
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
    const src = require("fs").readFileSync(`${__dirname}/seed-vertical-recurring-compliance.ts`, "utf8");
    for (const reg of VERTICAL_RECURRING_REGULATIONS) {
      for (const archetype of reg.applicability.archetypes ?? []) {
        expect(src, `${archetype} must appear as a literal`).toContain(`"${archetype}"`);
      }
    }
  });

  it("attributes every regulation to a real domain and cites an authority", () => {
    for (const reg of VERTICAL_RECURRING_REGULATIONS) {
      expect(isRegulationDomain(reg.domain), `${reg.regulationId} domain`).toBe(true);
      expect(reg.sourceUrl, `${reg.regulationId} must cite an authority`).toMatch(/^https:\/\//);
    }
  });

  it("uses only frequencies the deadline watch can classify", () => {
    const known = new Set(["annual", "biennial", "quarterly", "monthly", "continuous", "event-driven"]);
    for (const reg of VERTICAL_RECURRING_REGULATIONS) {
      for (const obl of reg.obligations) {
        expect(known, `${reg.regulationId}/${obl.reference}`).toContain(obl.frequency);
      }
    }
  });

  it("gives every archetype pack at least one REAL recurrence", () => {
    // A pack of purely standing duties leaves the calendar as empty as it was,
    // and the coverage measure refuses to count it.
    for (const reg of VERTICAL_RECURRING_REGULATIONS) {
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
    for (const reg of VERTICAL_RECURRING_REGULATIONS) {
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
    const unqualified = VERTICAL_RECURRING_REGULATIONS
      .flatMap((reg) => reg.obligations)
      .filter((obl) => !["continuous", "event-driven"].includes(obl.frequency))
      .filter((obl) => !qualifier.test(obl.applicability))
      .map((obl) => obl.reference);
    expect(unqualified).toEqual([]);
  });

  it("keeps obligation references unique so a re-seed cannot duplicate them", () => {
    const refs = VERTICAL_RECURRING_REGULATIONS.flatMap((r) => r.obligations.map((o) => o.reference));
    expect(new Set(refs).size).toBe(refs.length);
  });
});
