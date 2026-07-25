import { describe, expect, it } from "vitest";
import {
  OCCUPATION_SEED_DATA,
  OCCUPATION_INTERACTIONS,
  validateOccupationRegistry,
  knownArchetypeCategories,
  knownArchetypeIds,
  knownCoworkerSlugs,
  type OccupationSeed,
} from "./seed-occupations";
import { isKnownBaseAccessProfile, resolveBaseAccessRole } from "./occupation-access";

const refs = {
  categories: knownArchetypeCategories(),
  archetypeIds: knownArchetypeIds(),
  coworkerSlugs: knownCoworkerSlugs(),
};

function clone(seed: OccupationSeed): OccupationSeed {
  return JSON.parse(JSON.stringify(seed)) as OccupationSeed;
}

describe("occupation registry (shipped seed)", () => {
  it("loads the Phase-0 occupations", () => {
    expect(OCCUPATION_SEED_DATA.length).toBeGreaterThanOrEqual(4);
    const keys = OCCUPATION_SEED_DATA.map((o) => o.occupationKey);
    expect(keys).toContain("dental-hygienist");
    expect(keys).toContain("field-service-technician");
  });

  it("passes referential-integrity validation against the live catalogs", () => {
    expect(() => validateOccupationRegistry(OCCUPATION_SEED_DATA, refs)).not.toThrow();
  });

  it("references only real archetype categories and real coworker slugs", () => {
    for (const occ of OCCUPATION_SEED_DATA) {
      for (const cat of occ.archetypeCategories) {
        expect(refs.categories.has(cat)).toBe(true);
      }
      for (const grant of occ.coworkerRoster) {
        expect(refs.coworkerSlugs.has(grant.agentSlug)).toBe(true);
        expect(OCCUPATION_INTERACTIONS).toContain(grant.interaction);
      }
    }
  });

  it("has unique occupation keys", () => {
    const keys = OCCUPATION_SEED_DATA.map((o) => o.occupationKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("validateOccupationRegistry (fails closed)", () => {
  const base = clone(OCCUPATION_SEED_DATA[0]);

  it("rejects an unknown archetype category", () => {
    const bad = clone(base);
    bad.archetypeCategories = ["not-a-real-category"];
    expect(() => validateOccupationRegistry([bad], refs)).toThrow(/unknown archetype category/);
  });

  it("rejects an unknown coworker slug", () => {
    const bad = clone(base);
    bad.coworkerRoster = [{ agentSlug: "ghost-coworker", interaction: "summon" }];
    expect(() => validateOccupationRegistry([bad], refs)).toThrow(/unknown coworker slug/);
  });

  it("rejects an invalid interaction value", () => {
    const bad = clone(base);
    bad.coworkerRoster = [
      { agentSlug: base.coworkerRoster[0].agentSlug, interaction: "control" as never },
    ];
    expect(() => validateOccupationRegistry([bad], refs)).toThrow(/invalid interaction/);
  });

  it("rejects a duplicate occupation key", () => {
    expect(() => validateOccupationRegistry([clone(base), clone(base)], refs)).toThrow(
      /duplicate occupationKey/,
    );
  });

  it("rejects an empty tile allowlist", () => {
    const bad = clone(base);
    bad.featureSurface.tileAllowlist = [];
    expect(() => validateOccupationRegistry([bad], refs)).toThrow(/tileAllowlist/);
  });

  it("rejects an empty coworker roster", () => {
    const bad = clone(base);
    bad.coworkerRoster = [];
    expect(() => validateOccupationRegistry([bad], refs)).toThrow(/coworkerRoster/);
  });

  it("rejects a non-kebab occupationKey", () => {
    const bad = clone(base);
    bad.occupationKey = "Not_Valid Key";
    expect(() => validateOccupationRegistry([bad], refs)).toThrow(/kebab-case/);
  });

  it("rejects an unknown baseAccessProfile (P0.1 RBAC floor must resolve)", () => {
    const bad = clone(base);
    bad.baseAccessProfile = "root-admin";
    expect(() => validateOccupationRegistry([bad], refs)).toThrow(/unknown baseAccessProfile/);
  });
});

// EP-EMPLOYEE-OCCUPATION P0.1: the base-access-profile -> platform-role binding is
// the single source of truth (occupation-access.ts). Pin the workforce-member floor.
describe("base access profile binding", () => {
  it("maps every shipped occupation's baseAccessProfile to a known RBAC role", () => {
    for (const occ of OCCUPATION_SEED_DATA) {
      expect(isKnownBaseAccessProfile(occ.baseAccessProfile)).toBe(true);
    }
  });

  it("binds workforce-member to HR-600 (kernel-ratified DI-4F72F64B6C5B)", () => {
    expect(resolveBaseAccessRole("workforce-member")).toBe("HR-600");
    expect(resolveBaseAccessRole("unknown-profile")).toBeNull();
  });
});
