import { describe, expect, it } from "vitest";
import { buildDefaultLicenseRequirementSeed } from "./seed-license-requirements";

describe("licensing requirement seed defaults", () => {
  it("covers the first bootstrap jurisdictions with provenance and archetype hints", () => {
    const seed = buildDefaultLicenseRequirementSeed();

    const byId = new Map(seed.map((entry) => [entry.requirementRefId, entry]));
    const countries = new Set(seed.map((entry) => entry.countryCode));

    expect(countries.has("US")).toBe(true);
    expect(countries.has("GB")).toBe(true);
    expect(countries.has("AU")).toBe(true);

    expect(byId.get("LIC-REQ-US-BUSINESS-LICENSE")?.sourceUrls.length).toBeGreaterThan(0);
    expect(byId.get("LIC-REQ-GB-LICENCE-FINDER")?.confidence).toBeDefined();
    expect(byId.get("LIC-REQ-AU-ABLIS")?.staleAfterDays).toBeGreaterThan(0);
    expect(byId.get("LIC-REQ-US-BUSINESS-LICENSE")?.archetypeCategories.length).toBeGreaterThan(0);
  });

  it("covers public-sector orgs with charter and state-auditor filing directories (BI-8D477188)", () => {
    const seed = buildDefaultLicenseRequirementSeed();
    const publicSector = seed.filter((entry) =>
      entry.archetypeCategories.includes("public-sector"),
    );

    // Silent-seed-skip guard: the two civic directory entries must be present.
    expect(publicSector.map((entry) => entry.requirementRefId).sort()).toEqual([
      "LIC-REQ-US-MUNICIPAL-CHARTER",
      "LIC-REQ-US-STATE-AUDITOR-FILING",
    ]);
    for (const entry of publicSector) {
      expect(entry.sourceUrls.length).toBeGreaterThan(0);
      expect(entry.sourceKind).toBe("official");
    }
  });
});
