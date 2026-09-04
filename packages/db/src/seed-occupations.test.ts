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
    expect(keys).toContain("farm-ranch-owner-operator");
    expect(keys).toContain("farm-ranch-hand");
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

// Running the rescue for a day found the occupation registry held thirteen
// entries across healthcare, trades, agriculture and manufacturing and NONE for
// nonprofit-community, so the only role vocabulary a rescue manager saw was
// DPF's own HR-000..HR-600 ladder — its IT roles (BI-A30152B6). §5b of
// docs/architecture/archetypes/pet-rescue-operating-model.md names the eight
// roles the day needs, each traced to a step of §1.
describe("the roles a rescue's day requires", () => {
  const RESCUE_ROLES = [
    "kennel-technician",
    "animal-intake-officer",
    "veterinary-technician",
    "adoption-counsellor",
    "foster-coordinator",
    "volunteer-coordinator",
    "shelter-manager",
    "animal-transport-driver",
  ];

  it("offers every one of the eight §5b roles", () => {
    const keys = new Set(OCCUPATION_SEED_DATA.map((o) => o.occupationKey));
    for (const role of RESCUE_ROLES) {
      expect(keys.has(role), `${role} is missing`).toBe(true);
    }
  });

  it("reaches both animal-welfare archetypes and no others by id", () => {
    for (const role of RESCUE_ROLES) {
      const occ = OCCUPATION_SEED_DATA.find((o) => o.occupationKey === role)!;
      expect(occ.archetypeCategories).toEqual(["nonprofit-community"]);
      expect([...(occ.archetypeIds ?? [])].sort()).toEqual(["animal-shelter", "pet-rescue"]);
    }
  });

  it("gives each role a coworker it can summon", () => {
    for (const role of RESCUE_ROLES) {
      const occ = OCCUPATION_SEED_DATA.find((o) => o.occupationKey === role)!;
      const summonable = occ.coworkerRoster.filter((g) => g.interaction === "summon");
      expect(summonable.length, `${role} has nobody to summon`).toBeGreaterThan(0);
    }
  });

  // No animal-welfare specialist exists to roster yet: a coworker needs a
  // profession corpus and a model-tier floor before it can be defined, which is
  // its own piece of work (BI-DC11C687). Until then these roles summon the
  // general coworkers, and this asserts we did not quietly roster a ghost.
  it("rosters only coworkers that actually exist", () => {
    const known = knownCoworkerSlugs();
    for (const role of RESCUE_ROLES) {
      const occ = OCCUPATION_SEED_DATA.find((o) => o.occupationKey === role)!;
      for (const grant of occ.coworkerRoster) {
        expect(known.has(grant.agentSlug), `${role} rosters unknown ${grant.agentSlug}`).toBe(true);
      }
    }
  });

  it("leaves nonprofit-community no longer unserved", () => {
    const served = OCCUPATION_SEED_DATA.filter((o) =>
      o.archetypeCategories.includes("nonprofit-community"),
    );
    expect(served.length).toBeGreaterThanOrEqual(RESCUE_ROLES.length);
  });
});
