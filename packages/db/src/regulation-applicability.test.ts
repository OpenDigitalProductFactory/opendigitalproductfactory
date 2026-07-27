import { describe, it, expect } from "vitest";
import {
  regulationApplies,
  resolveConfirmedProcessingAuthority,
  parseApplicability,
  CADA_APPLICABILITY,
  UK_CORP_GOV_CODE_APPLICABILITY,
  isListingStatus,
  type RegionProfile,
  type RegulationApplicability,
} from "./regulation-applicability";

describe("confirmed processing authority", () => {
  it("requires an exact confirmed authority reference", () => {
    expect(
      resolveConfirmedProcessingAuthority("REG-PCI-DSS", ["REG-PCI-DSS"]),
    ).toEqual({
      confirmed: true,
      reason: "confirmed processing activity links REG-PCI-DSS",
    });
    expect(
      resolveConfirmedProcessingAuthority("REG-PCI-DSS", ["pci", "REG-GDPR"]).confirmed,
    ).toBe(false);
  });
});

const empty: RegionProfile = { operatesIn: [], sellsTo: [], employsIn: [], dataResidency: [] };

describe("regulationApplies — region scoping", () => {
  it("CADA does NOT apply to an org with no EU nexus", () => {
    const r = regulationApplies(CADA_APPLICABILITY, { ...empty, operatesIn: ["us"] });
    expect(r.applies).toBe(false);
    expect(r.reason).toMatch(/out of scope/);
  });

  it("CADA does NOT apply when nothing is declared", () => {
    expect(regulationApplies(CADA_APPLICABILITY, empty).applies).toBe(false);
  });

  it("CADA applies to an org operating in the EU", () => {
    const r = regulationApplies(CADA_APPLICABILITY, { ...empty, operatesIn: ["eu"] });
    expect(r.applies).toBe(true);
    expect(r.matchedBasis).toContain("operating");
  });

  it("CADA applies to a US supplier selling into the EU (the cascade)", () => {
    const r = regulationApplies(CADA_APPLICABILITY, { ...empty, operatesIn: ["us"], sellsTo: ["eu"] });
    expect(r.applies).toBe(true);
    expect(r.matchedBasis).toContain("selling");
  });

  it("employing in the EU alone does NOT trigger CADA", () => {
    const r = regulationApplies(CADA_APPLICABILITY, { ...empty, employsIn: ["eu"] });
    expect(r.applies).toBe(false);
  });
});

describe("regulationApplies — global + archetype", () => {
  it("a global regulation applies regardless of region", () => {
    const pci: RegulationApplicability = { basis: ["global"], jurisdictions: [] };
    expect(regulationApplies(pci, empty).applies).toBe(true);
  });

  it("an archetype-specific regulation gates on archetype", () => {
    const spec: RegulationApplicability = { basis: ["operating"], jurisdictions: ["eu"], archetypes: ["healthcare-provider"] };
    expect(regulationApplies(spec, { ...empty, operatesIn: ["eu"], archetype: "retailer" }).applies).toBe(false);
    expect(regulationApplies(spec, { ...empty, operatesIn: ["eu"], archetype: "healthcare-provider" }).applies).toBe(true);
  });
});

describe("regulationApplies — listing-status gate (UK Corporate Governance Code / Provision 29)", () => {
  it("applies to a UK-operating PREMIUM-LISTED company", () => {
    const r = regulationApplies(UK_CORP_GOV_CODE_APPLICABILITY, {
      ...empty,
      operatesIn: ["uk"],
      listingStatus: "premium-listed",
    });
    expect(r.applies).toBe(true);
    expect(r.matchedBasis).toContain("operating");
  });

  it("does NOT apply to a UK-operating PRIVATE company (listing gate)", () => {
    const r = regulationApplies(UK_CORP_GOV_CODE_APPLICABILITY, {
      ...empty,
      operatesIn: ["uk"],
      listingStatus: "private",
    });
    expect(r.applies).toBe(false);
    expect(r.reason).toMatch(/listing status/);
  });

  it("does NOT apply to a UK-operating company with UNDECLARED listing status", () => {
    const r = regulationApplies(UK_CORP_GOV_CODE_APPLICABILITY, { ...empty, operatesIn: ["uk"] });
    expect(r.applies).toBe(false);
    expect(r.reason).toMatch(/undeclared/);
  });

  it("does NOT apply to a premium-listed company with no UK operating nexus", () => {
    const r = regulationApplies(UK_CORP_GOV_CODE_APPLICABILITY, {
      ...empty,
      operatesIn: ["us"],
      listingStatus: "premium-listed",
    });
    expect(r.applies).toBe(false);
  });

  it("isListingStatus validates the canonical set", () => {
    expect(isListingStatus("premium-listed")).toBe(true);
    expect(isListingStatus("nasdaq")).toBe(false);
    expect(isListingStatus(null)).toBe(false);
  });
});

describe("regulationApplies — undeclared vs declared-mismatch (tri-state signal)", () => {
  it("flags undeclared when NOTHING is declared (reviewable)", () => {
    const r = regulationApplies(CADA_APPLICABILITY, empty);
    expect(r.applies).toBe(false);
    expect(r.undeclared).toBe(true);
  });

  it("flags a DECLARED-but-mismatched footprint as a definitive miss (not undeclared)", () => {
    const r = regulationApplies(CADA_APPLICABILITY, { ...empty, operatesIn: ["us"] });
    expect(r.applies).toBe(false);
    expect(r.undeclared).toBe(false);
  });

  it("undeclared is false when the regulation applies", () => {
    const r = regulationApplies(CADA_APPLICABILITY, { ...empty, operatesIn: ["eu"] });
    expect(r.applies).toBe(true);
    expect(r.undeclared).toBe(false);
  });

  it("treats an undeclared listing status (UK nexus present) as reviewable, not a miss", () => {
    const r = regulationApplies(UK_CORP_GOV_CODE_APPLICABILITY, { ...empty, operatesIn: ["uk"] });
    expect(r.applies).toBe(false);
    expect(r.undeclared).toBe(true);
  });

  it("treats a declared non-premium listing as a definitive miss", () => {
    const r = regulationApplies(UK_CORP_GOV_CODE_APPLICABILITY, {
      ...empty,
      operatesIn: ["uk"],
      listingStatus: "private",
    });
    expect(r.applies).toBe(false);
    expect(r.undeclared).toBe(false);
  });
});

describe("parseApplicability — tolerant parser for the stored JSON spec", () => {
  it("parses a well-formed spec including optional gates", () => {
    const spec = parseApplicability({
      basis: ["operating"],
      jurisdictions: ["uk"],
      listingStatuses: ["premium-listed"],
      archetypes: ["banking-financial-services"],
    });
    expect(spec).toEqual({
      basis: ["operating"],
      jurisdictions: ["uk"],
      listingStatuses: ["premium-listed"],
      archetypes: ["banking-financial-services"],
    });
  });

  it("round-trips the canonical consts", () => {
    expect(parseApplicability(CADA_APPLICABILITY)).toEqual(CADA_APPLICABILITY);
    expect(parseApplicability(UK_CORP_GOV_CODE_APPLICABILITY)).toEqual(UK_CORP_GOV_CODE_APPLICABILITY);
  });

  it("returns null for absent or malformed data (→ legacy fallback)", () => {
    expect(parseApplicability(null)).toBeNull();
    expect(parseApplicability(undefined)).toBeNull();
    expect(parseApplicability("nope")).toBeNull();
    expect(parseApplicability([])).toBeNull();
    expect(parseApplicability({ basis: "operating" })).toBeNull(); // basis not an array
    expect(parseApplicability({ jurisdictions: ["uk"] })).toBeNull(); // missing basis
  });
});

describe("archetypeGate — matches archetype id OR category (BI-9DED0CE8)", () => {
  const ncua: RegulationApplicability = {
    basis: ["operating"],
    jurisdictions: ["us"],
    archetypes: ["credit-union"],
  };
  const bsa: RegulationApplicability = {
    basis: ["operating"],
    jurisdictions: ["us"],
    archetypes: ["banking-financial-services"],
  };
  const creditUnion: RegionProfile = {
    ...empty,
    operatesIn: ["us"],
    archetype: "banking-financial-services",
    archetypeId: "credit-union",
  };
  const communityBank: RegionProfile = { ...creditUnion, archetypeId: "community-bank" };

  it("an id-scoped regime applies only to the matching archetype id", () => {
    expect(regulationApplies(ncua, creditUnion).applies).toBe(true);
    const miss = regulationApplies(ncua, communityBank);
    expect(miss.applies).toBe(false);
    expect(miss.undeclared).toBe(false); // declared mismatch → reference, not review
  });

  it("a category-scoped regime applies to every archetype id in the category", () => {
    expect(regulationApplies(bsa, creditUnion).applies).toBe(true);
    expect(regulationApplies(bsa, communityBank).applies).toBe(true);
  });

  it("law-enforcement-agency matches by id even though its category is public-sector", () => {
    const post: RegulationApplicability = {
      basis: ["operating"],
      jurisdictions: ["us"],
      archetypes: ["law-enforcement-agency"],
    };
    const agency: RegionProfile = {
      ...empty,
      operatesIn: ["us"],
      archetype: "public-sector",
      archetypeId: "law-enforcement-agency",
    };
    const town: RegionProfile = { ...agency, archetypeId: "small-town-municipality" };
    expect(regulationApplies(post, agency).applies).toBe(true);
    expect(regulationApplies(post, town).applies).toBe(false);
    // ...and the category-wide public-body regime still applies to the agency.
    const openMeetings: RegulationApplicability = {
      basis: ["operating"],
      jurisdictions: ["us"],
      archetypes: ["public-sector"],
    };
    expect(regulationApplies(openMeetings, agency).applies).toBe(true);
  });

  it("no archetype declared at all stays reviewable (undeclared)", () => {
    const r = regulationApplies(ncua, { ...empty, operatesIn: ["us"] });
    expect(r.applies).toBe(false);
    expect(r.undeclared).toBe(true);
  });
});
