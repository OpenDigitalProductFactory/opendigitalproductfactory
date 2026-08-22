import { describe, it, expect } from "vitest";

import { parseApplicability, isRegulationDomain } from "./regulation-applicability";
import { BUSINESS_OPERATIONS_REGULATIONS } from "./seed-business-operations-compliance";

// The value of a COMMON pack is that it reaches every install. That is also
// exactly what makes it dangerous: a row that does not really apply everywhere
// becomes noise on every install at once, and a recurrence that is wrong becomes
// a wrong date in front of every operator. These guard both directions.

describe("the common business-operations pack", () => {
  it("gates every regulation on a parseable, NON-archetype spec", () => {
    for (const reg of BUSINESS_OPERATIONS_REGULATIONS) {
      const parsed = parseApplicability(JSON.parse(JSON.stringify(reg.applicability)));
      expect(parsed, `${reg.regulationId} spec must parse`).not.toBeNull();
      expect(parsed!.basis.length).toBeGreaterThan(0);
      expect(parsed!.jurisdictions?.length, `${reg.regulationId} must gate on jurisdiction`).toBeGreaterThan(0);
      // A COMMON pack must NOT gate on archetype — that is what makes it common.
      // If a row needs an archetype gate it belongs in an archetype pack.
      expect(parsed!.archetypes ?? [], `${reg.regulationId} must not be archetype-gated`).toHaveLength(0);
    }
  });

  it("attributes every regulation to a real domain and cites a source", () => {
    for (const reg of BUSINESS_OPERATIONS_REGULATIONS) {
      expect(isRegulationDomain(reg.domain), `${reg.regulationId} domain`).toBe(true);
      expect(reg.sourceUrl, `${reg.regulationId} must cite an authority`).toMatch(/^https:\/\//);
    }
  });

  it("uses only frequencies the deadline watch can classify", () => {
    // Drift here is silent: an unrecognised word seeds fine and then the watch
    // reports the obligation as uncomputable on every install.
    const known = new Set(["annual", "quarterly", "monthly", "continuous", "event-driven"]);
    for (const reg of BUSINESS_OPERATIONS_REGULATIONS) {
      for (const obl of reg.obligations) {
        expect(known, `${reg.regulationId}/${obl.reference}`).toContain(obl.frequency);
      }
    }
  });

  it("actually adds recurring obligations — the gap it exists to close", () => {
    // A pack of standing duties would leave the calendar as empty as it was.
    const recurring = BUSINESS_OPERATIONS_REGULATIONS
      .flatMap((r) => r.obligations)
      .filter((o) => !["continuous", "event-driven"].includes(o.frequency));
    expect(recurring.length).toBeGreaterThanOrEqual(5);
  });

  it("states no threshold, rate, form number, or fixed due date", () => {
    // These move. A stale one printed next to a due date reads as authoritative,
    // which is worse than the operator looking it up themselves.
    const forbidden = /\$[\d,]|\bForm \d|\b\d{2,3}%|\bJanuary 3\d|\bApril 1\d\b/;
    for (const reg of BUSINESS_OPERATIONS_REGULATIONS) {
      for (const obl of reg.obligations) {
        const text = `${obl.title} ${obl.description} ${obl.applicability} ${obl.penaltySummary ?? ""}`;
        expect(forbidden.test(text), `${obl.reference} states a volatile specific`).toBe(false);
      }
    }
  });

  it("keeps obligation references unique so a re-seed cannot duplicate them", () => {
    const refs = BUSINESS_OPERATIONS_REGULATIONS.flatMap((r) => r.obligations.map((o) => o.reference));
    expect(new Set(refs).size).toBe(refs.length);
  });
});
