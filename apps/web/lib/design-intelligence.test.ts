// BI-018AE129 — the design-intelligence data plane must load, and must fail
// LOUD when it cannot. Every prod build ran with silently-empty design
// guidance because nothing asserted these domains load >0 rows; this test is
// the repo-side capability probe (the boot-side probe reads
// designIntelligenceHealth()).
import { describe, expect, it } from "vitest";
import {
  designIntelligenceHealth,
  generateDesignSystem,
  searchDesignDomain,
} from "./design-intelligence";

describe("design-intelligence data plane (BI-018AE129)", () => {
  it("loads every domain with at least one row", () => {
    const health = designIntelligenceHealth();
    for (const [domain, rows] of Object.entries(health)) {
      expect(rows, `domain "${domain}" loaded 0 rows — data dir unresolvable or file missing`).toBeGreaterThan(0);
    }
  });

  it("answers plain corpus-word queries (the live-repro case)", () => {
    // "hierarchy" (7 rows in ui-reasoning.csv) returned nothing on the live
    // install — the data-plane repro. NOTE: pick words that exist in the
    // corpus; e.g. "dashboard" has zero ux-guidelines rows, so an empty
    // result for it is corpus shape, not a loading failure.
    expect(searchDesignDomain("hierarchy", "reasoning", 5).length).toBeGreaterThan(0);
    expect(searchDesignDomain("navigation", "ux", 5).length).toBeGreaterThan(0);
  });

  it("assembles a data-backed design system recommendation", () => {
    const system = generateDesignSystem("SaaS analytics dashboard");
    // With empty domains the generator still emits the title + static
    // checklist — the data-dependent sections are the discriminator.
    expect(system, "recommendation carries no data-backed style section").toContain("## Recommended Style");
  });
});
