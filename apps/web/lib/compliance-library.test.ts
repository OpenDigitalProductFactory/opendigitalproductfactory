import { describe, expect, it } from "vitest";

import {
  addObligationApplicability,
  addRegulationApplicability,
  classifyRegulationForInstall,
  complianceLibraryContextLabel,
  countByComplianceLibraryScope,
  filterByComplianceLibraryScope,
  parseComplianceLibraryScope,
  type ClassifiableRegulation,
  type ComplianceLibraryContext,
} from "./compliance-library";

const softwareContext: ComplianceLibraryContext = {
  archetype: {
    archetypeId: "software-platform",
    name: "Software Platform",
    category: "software-platform",
  },
  businessContext: {
    industry: "software-platform",
    stateCode: null,
    handlesCardPayments: false,
  },
  regional: {
    archetype: "software-platform",
    operatesIn: [],
    sellsTo: [],
    employsIn: [],
    dataResidency: [],
  },
};

const bankingContext: ComplianceLibraryContext = {
  ...softwareContext,
  archetype: {
    archetypeId: "community-bank",
    name: "Community Bank",
    category: "banking-financial-services",
  },
  businessContext: {
    ...softwareContext.businessContext,
    industry: "financial",
  },
  regional: {
    ...softwareContext.regional,
    archetype: "banking-financial-services",
  },
};

const publicSectorContext: ComplianceLibraryContext = {
  ...softwareContext,
  archetype: {
    archetypeId: "municipal-government",
    name: "Municipal Government",
    category: "public-sector",
  },
  businessContext: {
    ...softwareContext.businessContext,
    industry: "public-sector",
    stateCode: null,
  },
  regional: {
    ...softwareContext.regional,
    archetype: "public-sector",
    operatesIn: ["us"],
  },
};

function regulation(overrides: Partial<ClassifiableRegulation>): ClassifiableRegulation {
  return {
    regulationId: "REG-US-BSA-AML",
    name: "Bank Secrecy Act / Anti-Money Laundering",
    shortName: "BSA/AML",
    jurisdiction: "US-federal",
    industry: "financial",
    sourceType: "external",
    sourceUrl: "https://www.fincen.gov/resources/statutes-and-regulations/bank-secrecy-act",
    ...overrides,
  };
}

describe("compliance library applicability", () => {
  it("classifies banking regulations as reference material for a software-platform install", () => {
    const result = classifyRegulationForInstall(regulation({}), softwareContext);

    expect(result.scope).toBe("reference");
    expect(result.reason).toContain("Seeded for banking or financial services");
    expect(result.reason).toContain("Software Platform");
  });

  it("classifies banking regulations as applicable for a banking archetype", () => {
    const result = classifyRegulationForInstall(regulation({}), bankingContext);

    expect(result.scope).toBe("applies");
    expect(result.reason).toContain("Community Bank");
  });

  it("marks state-law matches for review when the state has not been captured", () => {
    const result = classifyRegulationForInstall(
      regulation({
        regulationId: "REG-US-STATE-OPEN-MEETINGS",
        name: "State Open Meetings Law (Sunshine Law)",
        shortName: "Open Meetings",
        jurisdiction: "US-state",
        industry: "public-sector",
        sourceUrl: null,
      }),
      publicSectorContext,
    );

    expect(result.scope).toBe("review");
    expect(result.reason).toContain("applicable state has not been captured");
  });

  it("uses the shared CADA regional nexus rule", () => {
    const cada = regulation({
      regulationId: "REG-CADA-2026",
      name: "Cloud and AI Development Act",
      shortName: "CADA",
      jurisdiction: "EU",
      industry: null,
      sourceUrl: "https://digital-strategy.ec.europa.eu/en/policies/cloud-and-ai-development-act",
    });

    expect(classifyRegulationForInstall(cada, softwareContext).scope).toBe("review");

    const euSupplier = {
      ...softwareContext,
      regional: { ...softwareContext.regional, sellsTo: ["eu"] },
    };
    const result = classifyRegulationForInstall(cada, euSupplier);
    expect(result.scope).toBe("applies");
    expect(result.reason).toContain("regional nexus");
  });

  it("filters and counts by applicability scope", () => {
    const rows = [
      addRegulationApplicability(regulation({}), softwareContext),
      addRegulationApplicability(
        regulation({
          regulationId: "REG-CADA-2026",
          name: "Cloud and AI Development Act",
          shortName: "CADA",
          jurisdiction: "EU",
          industry: null,
        }),
        softwareContext,
      ),
    ];

    expect(filterByComplianceLibraryScope(rows, "applies")).toHaveLength(0);
    expect(filterByComplianceLibraryScope(rows, "reference")).toHaveLength(1);
    expect(countByComplianceLibraryScope(rows)).toEqual({
      applies: 0,
      review: 1,
      reference: 1,
      all: 2,
    });
  });

  it("inherits regulation applicability onto obligations", () => {
    const obligation = addObligationApplicability(
      {
        id: "obl-1",
        title: "Suspicious Activity Report filing",
        regulation: regulation({}),
      },
      softwareContext,
    );

    expect(obligation.regulation.applicability.scope).toBe("reference");
  });

  it("parses unknown scope values back to the default applies scope", () => {
    expect(parseComplianceLibraryScope("review")).toBe("review");
    expect(parseComplianceLibraryScope("unexpected")).toBe("applies");
    expect(complianceLibraryContextLabel(softwareContext)).toBe("Software Platform (software-platform)");
  });

  describe("UK Corporate Governance Code / Provision 29 (listing-gated)", () => {
    const ukCorpGov = regulation({
      regulationId: "REG-UK-CORP-GOV-CODE",
      name: "UK Corporate Governance Code (2024) — Provision 29",
      shortName: "UK Corp Gov Code / Provision 29",
      jurisdiction: "UK",
      industry: null,
      sourceUrl: null,
    });

    function ukContext(
      overrides: Partial<ComplianceLibraryContext["regional"]>,
    ): ComplianceLibraryContext {
      return { ...softwareContext, regional: { ...softwareContext.regional, ...overrides } };
    }

    it("applies to a UK-operating premium-listed company", () => {
      const result = classifyRegulationForInstall(
        ukCorpGov,
        ukContext({ operatesIn: ["uk"], listingStatus: "premium-listed" }),
      );
      expect(result.scope).toBe("applies");
      expect(result.reason).toContain("premium-listed");
    });

    it("needs review when no operating footprint is captured", () => {
      expect(classifyRegulationForInstall(ukCorpGov, softwareContext).scope).toBe("review");
    });

    it("needs review when UK-operating but listing status is undeclared", () => {
      const result = classifyRegulationForInstall(ukCorpGov, ukContext({ operatesIn: ["uk"] }));
      expect(result.scope).toBe("review");
      expect(result.reason).toContain("market-listing status");
    });

    it("is reference for a UK-operating private company", () => {
      const result = classifyRegulationForInstall(
        ukCorpGov,
        ukContext({ operatesIn: ["uk"], listingStatus: "private" }),
      );
      expect(result.scope).toBe("reference");
      expect(result.reason).toContain("private");
    });

    it("is reference when the business does not operate in the UK", () => {
      const result = classifyRegulationForInstall(
        ukCorpGov,
        ukContext({ operatesIn: ["us"], listingStatus: "premium-listed" }),
      );
      expect(result.scope).toBe("reference");
      expect(result.reason).toContain("does not operate in the UK");
    });
  });
});
