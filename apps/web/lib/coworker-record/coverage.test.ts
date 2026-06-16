// apps/web/lib/coworker-record/coverage.test.ts
// EP-AI-WORKFORCE-001 (HRIS surface) — pure-logic guards for the coworker
// record's profession facet. No DB: covers the variant-axis normalization
// parity with the seed and the WSID "every active role resolves" contract.

import { describe, it, expect } from "vitest";
import { normalizeVariantAxes } from "./variant-axes";
import {
  PROFESSION_REGISTRY,
  findProfessionFamily,
} from "@/lib/decision-perspective/resolve-profession-profile";

describe("normalizeVariantAxes", () => {
  it("defaults to global / practitioner / universal when metadata is empty (seed parity)", () => {
    expect(normalizeVariantAxes(null)).toEqual({ jurisdictions: ["global"], level: "practitioner", archetypes: ["universal"] });
    expect(normalizeVariantAxes({})).toEqual({ jurisdictions: ["global"], level: "practitioner", archetypes: ["universal"] });
  });

  it("reads persisted variant axes from metadata", () => {
    expect(
      normalizeVariantAxes({ professionJurisdiction: ["us", "eu"], professionCompetencyLevel: "expert" }),
    ).toEqual({ jurisdictions: ["us", "eu"], level: "expert", archetypes: ["universal"] });
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
