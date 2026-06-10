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

  it("seeds the banking regulatory authority entries (BI-5D9DCDE6 spec §9.1)", () => {
    const seed = buildDefaultLicenseRequirementSeed();
    const banking = seed.filter((entry) =>
      entry.archetypeCategories.includes("banking-financial-services"),
    );
    const ids = banking.map((entry) => entry.requirementRefId);

    // Count assertion — the silent-seed-skip guard. All 14 banking authority
    // entries from spec §9.1 must be present in the bootstrap reference data.
    expect(ids.sort()).toEqual(
      [
        "LIC-REQ-AU-APRA-ASIC",
        "LIC-REQ-CA-OSFI",
        "LIC-REQ-EU-EBA-NCA",
        "LIC-REQ-GB-FCA-PRA",
        "LIC-REQ-US-CFPB-CONSUMER-PROTECTION",
        "LIC-REQ-US-CSBS-STATE-BANKING",
        "LIC-REQ-US-EQUAL-HOUSING",
        "LIC-REQ-US-FDIC-INSURANCE",
        "LIC-REQ-US-FINCEN-BSA-AML",
        "LIC-REQ-US-FRB-STATE-MEMBER-BANK",
        "LIC-REQ-US-NCUA-CREDIT-UNION",
        "LIC-REQ-US-NMLS-MLO",
        "LIC-REQ-US-NMLS-ORG",
        "LIC-REQ-US-OCC-NATIONAL-BANK",
      ].sort(),
    );

    // Doctrine invariants: official sources only, directories not legal
    // conclusions (confidence stays medium, staleness bounded), and the
    // closed licensing enums from apps/web/lib/licensing.ts are respected.
    const REQUIREMENT_TYPES = [
      "license", "permit", "registration", "certification", "endorsement",
      "inspection", "display_rule", "legality_gate", "license_directory", "licence_directory",
    ];
    const SCOPE_LEVELS = ["organization", "person", "premises", "activity", "vehicle", "equipment"];
    for (const entry of banking) {
      expect(entry.sourceKind, entry.requirementRefId).toBe("official");
      expect(entry.sourceUrls.length, entry.requirementRefId).toBeGreaterThan(0);
      expect(entry.staleAfterDays, entry.requirementRefId).toBeGreaterThan(0);
      expect(REQUIREMENT_TYPES, `${entry.requirementRefId} requirementType ${entry.requirementType}`).toContain(entry.requirementType);
      expect(SCOPE_LEVELS, `${entry.requirementRefId} scopeLevel ${entry.scopeLevel}`).toContain(entry.scopeLevel);
    }

    // Display obligations captured where the regulator imposes one (spec §9.3).
    const byId = new Map(banking.map((entry) => [entry.requirementRefId, entry]));
    expect(byId.get("LIC-REQ-US-FDIC-INSURANCE")?.displayRuleSummary).toContain("Member FDIC");
    expect(byId.get("LIC-REQ-US-NCUA-CREDIT-UNION")?.displayRuleSummary).toContain("NCUA");
    expect(byId.get("LIC-REQ-US-NMLS-ORG")?.displayRuleSummary).toContain("NMLS Unique Identifier");
    expect(byId.get("LIC-REQ-US-EQUAL-HOUSING")?.displayRuleSummary).toContain("Equal Housing");

    // Person-scope professional licensing exists for mortgage loan originators.
    expect(byId.get("LIC-REQ-US-NMLS-MLO")?.scopeLevel).toBe("person");
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
