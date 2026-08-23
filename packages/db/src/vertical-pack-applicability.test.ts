import { describe, it, expect } from "vitest";

import { parseApplicability, regulationApplies, type RegionProfile } from "./regulation-applicability";
import { VERTICAL_RECURRING_REGULATIONS } from "./seed-vertical-recurring-compliance";
import { PEOPLE_PREMISES_REGULATIONS } from "./seed-people-premises-compliance";
import { INDUSTRIAL_VERTICAL_REGULATIONS } from "./seed-industrial-vertical-compliance";

// Packs are seeded to EVERY install and filtered per-install. So the property
// that matters is not "does my pack seed" — it always does — but "does it stay
// out of the way of an install it does not bind on".
//
// The live defect this pins: a software-platform install carried 69 obligations
// from regimes that do not apply to it, and the deadline watch reported them as
// overdue because it never asked.

const ALL = [
  ...VERTICAL_RECURRING_REGULATIONS,
  ...PEOPLE_PREMISES_REGULATIONS,
  ...INDUSTRIAL_VERTICAL_REGULATIONS,
];

const profileFor = (archetype: string): RegionProfile => ({
  operatesIn: ["us"],
  sellsTo: ["us"],
  employsIn: ["us"],
  dataResidency: ["us"],
  archetype,
  archetypeId: archetype,
});

const appliesTo = (reg: (typeof ALL)[number], archetype: string) =>
  regulationApplies(
    parseApplicability(JSON.parse(JSON.stringify(reg.applicability)))!,
    profileFor(archetype),
  ).applies;

describe("archetype packs stay out of the way of installs they do not bind on", () => {
  it("reaches the archetypes it declares", () => {
    for (const reg of ALL) {
      const declared = parseApplicability(JSON.parse(JSON.stringify(reg.applicability)))!.archetypes ?? [];
      for (const archetype of declared) {
        expect(appliesTo(reg, archetype), `${reg.regulationId} must apply to ${archetype}`).toBe(true);
      }
    }
  });

  it("reaches NOTHING it does not declare", () => {
    const everyDeclared = new Set(
      ALL.flatMap((r) => parseApplicability(JSON.parse(JSON.stringify(r.applicability)))!.archetypes ?? []),
    );
    const leaks: string[] = [];
    for (const reg of ALL) {
      const declared = new Set(
        parseApplicability(JSON.parse(JSON.stringify(reg.applicability)))!.archetypes ?? [],
      );
      for (const archetype of everyDeclared) {
        if (declared.has(archetype)) continue;
        if (appliesTo(reg, archetype)) leaks.push(`${reg.regulationId} -> ${archetype}`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it("keeps a software platform clear of every trade pack", () => {
    // The concrete shape of the live defect, stated as its own case.
    const reaching = ALL
      .filter((reg) => appliesTo(reg, "software-platform"))
      .map((reg) => reg.regulationId);
    expect(reaching).toEqual(["REG-US-SOFTWARE-ASSURANCE-CYCLE"]);
  });

  it("keeps a restaurant clear of clinical, carrier and security packs", () => {
    const reaching = ALL
      .filter((reg) => appliesTo(reg, "food-hospitality"))
      .map((reg) => reg.regulationId);
    expect(reaching).toEqual(["REG-US-FOOD-SERVICE-OPS"]);
  });
});
