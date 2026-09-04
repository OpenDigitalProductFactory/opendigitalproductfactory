import { describe, expect, it, vi } from "vitest";
import { ALL_ARCHETYPES } from "@dpf/storefront-templates";

import {
  seedArchetypeWorkforce,
  workforceProfileFor,
  type SeedArchetypeWorkforceClient,
} from "./seed-archetype-workforce";

// Running the rescue for a day found the platform offered Headquarters, Remote
// and Hybrid, and no worker class for the shelter's largest labour pool
// (BI-A30152B6). §5b of the pet-rescue operating model names what the day needs.

function client(overrides: {
  archetypeId?: string | null;
  existingEmploymentTypes?: string[];
  existingWorkLocations?: string[];
}) {
  const employmentTypes = new Set(overrides.existingEmploymentTypes ?? []);
  const workLocations = new Set(overrides.existingWorkLocations ?? []);
  const created = { employmentTypes: [] as unknown[], workLocations: [] as unknown[] };
  const selects: string[] = [];

  const db: SeedArchetypeWorkforceClient = {
    storefrontConfig: {
      // The real row shape. `StorefrontConfig.archetypeId` is a cuid FK to
      // `StorefrontArchetype.id`; the SLUG lives on the related row. The first
      // version of this fake returned `{ archetypeId: "pet-rescue" }` — the
      // shape the caller assumed rather than the one the database has — so nine
      // tests passed against a seeder that could never match (BI-A30152B6).
      findFirst: vi.fn(async (args: unknown) => {
        selects.push(JSON.stringify((args as { select?: unknown }).select ?? {}));
        if (overrides.archetypeId === null) return null;
        return { archetype: { archetypeId: overrides.archetypeId ?? "pet-rescue" } };
      }),
    },
    employmentType: {
      findUnique: vi.fn(async (args: unknown) => {
        const id = (args as { where: { employmentTypeId: string } }).where.employmentTypeId;
        return employmentTypes.has(id) ? { id } : null;
      }),
      create: vi.fn(async (args: unknown) => {
        created.employmentTypes.push((args as { data: unknown }).data);
        return {};
      }),
    },
    workLocation: {
      findUnique: vi.fn(async (args: unknown) => {
        const id = (args as { where: { locationId: string } }).where.locationId;
        return workLocations.has(id) ? { id } : null;
      }),
      create: vi.fn(async (args: unknown) => {
        created.workLocations.push((args as { data: unknown }).data);
        return {};
      }),
    },
  };
  return { db, created, selects };
}

describe("the rescue's declared workforce", () => {
  it("names places an animal actually lives, not office arrangements", () => {
    const profile = workforceProfileFor("pet-rescue")!;
    const names = (profile.workLocations ?? []).map((l) => l.name);

    expect(names).toContain("Dog ward");
    expect(names).toContain("Isolation");
    expect(names).toContain("Foster home");
    expect(names).not.toContain("Headquarters");
    expect(names).not.toContain("Hybrid");
  });

  it("carries the second unpaid class, classified as unpaid", () => {
    const profile = workforceProfileFor("pet-rescue")!;
    expect(profile.employmentTypes).toEqual([
      { employmentTypeId: "emp-foster-carer", name: "Foster carer", classification: "volunteer" },
    ]);
  });

  it("reaches the animal shelter too — the same day, a different name", () => {
    expect(workforceProfileFor("animal-shelter")).toEqual(workforceProfileFor("pet-rescue"));
  });

  it("does not reach an archetype whose day is nothing like it", () => {
    expect(workforceProfileFor("restaurant")).toBeNull();
  });

  it("declares no row an archetype could not honour", () => {
    for (const archetype of ALL_ARCHETYPES) {
      for (const location of archetype.workforceProfile?.workLocations ?? []) {
        expect(location.locationId).toMatch(/^loc-[a-z0-9-]+$/);
      }
      for (const employmentType of archetype.workforceProfile?.employmentTypes ?? []) {
        expect(employmentType.employmentTypeId).toMatch(/^emp-[a-z0-9-]+$/);
      }
    }
  });
});

describe("seedArchetypeWorkforce", () => {
  it("applies the rescue's rows to an install running a rescue", async () => {
    const { db, created } = client({ archetypeId: "pet-rescue" });

    const result = await seedArchetypeWorkforce({ organizationId: "org-1", db });

    expect(result.employmentTypesAdded).toEqual(["emp-foster-carer"]);
    expect(result.workLocationsAdded).toContain("loc-dog-ward");
    expect(result.workLocationsAdded).toHaveLength(7);
    expect(created.employmentTypes[0]).toMatchObject({
      employmentTypeId: "emp-foster-carer",
      classification: "volunteer",
      status: "active",
    });
  });

  it("gives a restaurant no cat room", async () => {
    const { db, created } = client({ archetypeId: "restaurant" });

    const result = await seedArchetypeWorkforce({ organizationId: "org-1", db });

    expect(result).toMatchObject({ employmentTypesAdded: [], workLocationsAdded: [] });
    expect(created.workLocations).toEqual([]);
  });

  it("is safe to re-run, and never rewrites a row an operator has edited", async () => {
    const { db, created } = client({
      archetypeId: "pet-rescue",
      existingEmploymentTypes: ["emp-foster-carer"],
      existingWorkLocations: ["loc-dog-ward", "loc-cat-room", "loc-isolation", "loc-intake", "loc-surgery", "loc-foster-home", "loc-adoption-event"],
    });

    const result = await seedArchetypeWorkforce({ organizationId: "org-1", db });

    expect(result).toMatchObject({ employmentTypesAdded: [], workLocationsAdded: [] });
    expect(created.employmentTypes).toEqual([]);
    expect(created.workLocations).toEqual([]);
  });

  it("does nothing when the install has no storefront yet", async () => {
    const { db } = client({ archetypeId: null });

    const result = await seedArchetypeWorkforce({ organizationId: "org-1", db });

    expect(result).toEqual({ archetypeId: null, employmentTypesAdded: [], workLocationsAdded: [] });
  });
});

// The rows have to reach an install that finished onboarding before the
// archetype declared them. `runSetupCompletionSeeds` is re-run on boot only by
// the WWWD backfill, which short-circuits on a healthy corpus — so without this
// reconciler a rescue keeps Headquarters / Remote / Hybrid forever and nothing
// self-heals it.
describe("backfillArchetypeWorkforceOnBoot", () => {
  it("is exported so instrumentation can run it beside the sibling reconcilers", async () => {
    const module = await import("./seed-archetype-workforce");
    expect(typeof module.backfillArchetypeWorkforceOnBoot).toBe("function");
  });
});

// The bug this file did not catch the first time: the seeder read the cuid
// foreign key and matched it against a slug, so it seeded nothing on every real
// install while every test passed (BI-A30152B6).
describe("reading the archetype", () => {
  it("resolves the slug through the relation, never the raw foreign key", async () => {
    const { db, selects } = client({ archetypeId: "pet-rescue" });

    await seedArchetypeWorkforce({ organizationId: "org-1", db });

    expect(selects).toHaveLength(1);
    const select = JSON.parse(selects[0]!);
    expect(select).toEqual({ archetype: { select: { archetypeId: true } } });
    // `archetypeId` at the top level is the cuid FK — selecting it is the bug.
    expect(Object.keys(select)).not.toContain("archetypeId");
  });

  it("seeds nothing rather than guessing when a cuid arrives where a slug belongs", async () => {
    const { db } = client({ archetypeId: "cmt6ejtsj09rr6mnw0ds02g58" });

    const result = await seedArchetypeWorkforce({ organizationId: "org-1", db });

    expect(result).toMatchObject({ employmentTypesAdded: [], workLocationsAdded: [] });
  });
});
