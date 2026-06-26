// apps/web/lib/coworker-record/coverage.test.ts
// EP-AI-WORKFORCE-001 (HRIS surface) — pure-logic guards for the coworker
// record's profession facet. No DB: covers the variant-axis normalization
// parity with the seed and the WSID "every active role resolves" contract.

import { describe, it, expect } from "vitest";
import { normalizeVariantAxes } from "./variant-axes";
import { jurisdictionGaps, type ProfessionCoverage } from "./coverage";
import {
  PROFESSION_REGISTRY,
  findProfessionFamily,
} from "@/lib/decision-perspective/resolve-profession-profile";

const baseCoverage: ProfessionCoverage = {
  professionKey: "x",
  label: "X",
  pageCount: 0,
  jurisdiction: {},
  competency: {},
  archetype: {},
  checklist: [],
  emptyCorpus: false,
};

describe("normalizeVariantAxes", () => {
  it("defaults to global / practitioner / universal / global-basis when metadata is empty (seed parity)", () => {
    expect(normalizeVariantAxes(null)).toEqual({ jurisdictions: ["global"], level: "practitioner", archetypes: ["universal"], basis: "global" });
    expect(normalizeVariantAxes({})).toEqual({ jurisdictions: ["global"], level: "practitioner", archetypes: ["universal"], basis: "global" });
  });

  it("reads persisted variant axes from metadata (specific jurisdiction defaults basis to operating)", () => {
    expect(
      normalizeVariantAxes({ professionJurisdiction: ["us", "eu"], professionCompetencyLevel: "expert" }),
    ).toEqual({ jurisdictions: ["us", "eu"], level: "expert", archetypes: ["universal"], basis: "operating" });
  });

  it("reads an explicit jurisdiction basis from metadata", () => {
    expect(
      normalizeVariantAxes({ professionJurisdiction: ["eu"], professionJurisdictionBasis: "selling" }).basis,
    ).toBe("selling");
  });

  it("falls back to global when jurisdiction array is empty", () => {
    expect(normalizeVariantAxes({ professionJurisdiction: [] }).jurisdictions).toEqual(["global"]);
  });
});

describe("profession registry coverage contract (WSID §4.11)", () => {
  it("has families and every role binds back to exactly its family", () => {
    expect(PROFESSION_REGISTRY.families.length).toBeGreaterThan(0);
    for (const family of PROFESSION_REGISTRY.families) {
      for (const role of family.roles) {
        const resolved = findProfessionFamily(role);
        expect(resolved?.professionKey, `role "${role}" should resolve`).toBe(family.professionKey);
      }
    }
  });

  it("declares a coverage checklist for every family (corpus completeness frame)", () => {
    for (const family of PROFESSION_REGISTRY.families) {
      expect(Array.isArray(family.coverageChecklist), family.professionKey).toBe(true);
    }
  });
});

describe("jurisdictionGaps (surfaces the risk a volume-only coverage % hides)", () => {
  it("flags a non-global jurisdiction with 0 pages when others are covered", () => {
    expect(jurisdictionGaps({ ...baseCoverage, jurisdiction: { global: 5, us: 2, eu: 3, uk: 0 } })).toEqual(["uk"]);
  });
  it("returns [] for global-only / universal families (no jurisdiction-specific gap implied)", () => {
    expect(jurisdictionGaps({ ...baseCoverage, jurisdiction: { global: 5, us: 0, eu: 0, uk: 0 } })).toEqual([]);
  });
  it("returns [] when every non-global jurisdiction is covered", () => {
    expect(jurisdictionGaps({ ...baseCoverage, jurisdiction: { global: 5, us: 1, eu: 1, uk: 1 } })).toEqual([]);
  });
});
