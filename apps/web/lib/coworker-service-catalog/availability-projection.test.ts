import { describe, expect, it } from "vitest";

import { hasExactCoworkerArchetypeDeclaration } from "./archetype-declarations";
import {
  projectCoworkerAvailability,
  resolveInstallArchetypeContext,
} from "./availability-projection";

const restaurant = {
  archetypeId: "restaurant",
  category: "food-hospitality",
};
const readinessClear = {
  status: "evaluated",
  blockers: [],
  missingPrerequisites: [],
} as const;

describe("projectCoworkerAvailability", () => {
  it("reports a validated leaf match ahead of a category match", () => {
    expect(
      projectCoworkerAvailability({
        install: restaurant,
        declarations: ["food-hospitality", "restaurant"],
        readiness: readinessClear,
      }),
    ).toMatchObject({
      state: "available",
      label: "Available for your business type",
      matchLevel: "leaf",
      reason: "This coworker explicitly supports the restaurant business type.",
    });
  });

  it("reports a validated category match", () => {
    expect(
      projectCoworkerAvailability({
        install: restaurant,
        declarations: ["food-hospitality"],
        readiness: readinessClear,
      }),
    ).toMatchObject({
      state: "available",
      matchLevel: "category",
      reason: "This coworker supports the food-hospitality business category.",
    });
  });

  it("reports not available only when every declaration is valid and none match", () => {
    expect(
      projectCoworkerAvailability({
        install: restaurant,
        declarations: ["professional-services", "hair-salon"],
      }),
    ).toMatchObject({
      state: "not-available",
      label: "Not available for your business type",
      matchLevel: null,
    });
  });

  it.each([
    { declarations: [], name: "empty declarations" },
    { declarations: ["*"], name: "wildcard declarations" },
    { declarations: ["food-hospitality", "not-a-real-archetype"], name: "mixed valid and invalid declarations" },
    { declarations: ["food-hospitality", 42], name: "mixed string and non-string declarations" },
    { declarations: "food-hospitality", name: "non-array declarations" },
  ])("returns conservative unknown for $name", ({ declarations }) => {
    expect(
      projectCoworkerAvailability({
        install: restaurant,
        declarations,
      }),
    ).toMatchObject({
      state: "coverage-not-defined",
      label: "Coverage not defined",
      matchLevel: null,
    });
  });

  it.each([
    { install: null, name: "missing install" },
    { install: { archetypeId: "restaurant", category: "software-platform" }, name: "contradictory install" },
    { install: { archetypeId: "not-real", category: "food-hospitality" }, name: "unknown leaf" },
  ])("returns conservative unknown for $name", ({ install }) => {
    expect(
      projectCoworkerAvailability({
        install,
        declarations: ["food-hospitality"],
      }),
    ).toMatchObject({
      state: "coverage-not-defined",
      label: "Coverage not defined",
    });
  });

  it("evaluates blockers before setup only after applicability is positive", () => {
    expect(
      projectCoworkerAvailability({
        install: restaurant,
        declarations: ["restaurant"],
        readiness: {
          status: "evaluated",
          blockers: ["Customer messaging provider is disconnected"],
          missingPrerequisites: ["Operating hours"],
        },
      }),
    ).toMatchObject({
      state: "needs-attention",
      label: "Needs attention",
      matchLevel: "leaf",
    });
  });

  it("reports setup needed only after applicability is positive", () => {
    expect(
      projectCoworkerAvailability({
        install: restaurant,
        declarations: ["food-hospitality"],
        readiness: {
          status: "evaluated",
          blockers: [],
          missingPrerequisites: ["Operating hours", "Customer contact channel"],
        },
      }),
    ).toMatchObject({
      state: "setup-needed",
      label: "Setup needed",
      matchLevel: "category",
    });

    expect(
      projectCoworkerAvailability({
        install: restaurant,
        declarations: ["professional-services"],
        readiness: {
          status: "evaluated",
          blockers: [],
          missingPrerequisites: ["Operating hours"],
        },
      }),
    ).toMatchObject({
      state: "not-available",
      label: "Not available for your business type",
    });
  });

  it("carries install, declaration, and setup evidence with the result", () => {
    const projection = projectCoworkerAvailability({
      install: restaurant,
      declarations: ["food-hospitality"],
      readiness: {
        status: "evaluated",
        blockers: [],
        missingPrerequisites: ["Operating hours"],
      },
    });

    expect(projection.evidence).toEqual([
      {
        source: "storefront-archetype",
        values: ["restaurant", "food-hospitality"],
      },
      {
        source: "coworker-service-archetypes",
        values: ["food-hospitality"],
      },
      {
        source: "readiness-evaluation",
        values: ["evaluated"],
      },
      {
        source: "setup-prerequisite",
        values: ["Operating hours"],
      },
    ]);
  });

  it("does not infer availability when readiness was not evaluated", () => {
    expect(
      projectCoworkerAvailability({
        install: restaurant,
        declarations: ["restaurant"],
      }),
    ).toMatchObject({
      state: "coverage-not-defined",
      label: "Coverage not defined",
      evidence: expect.arrayContaining([
        {
          source: "readiness-evaluation",
          values: [
            "not-evaluated",
            "Setup and blocker readiness has not been evaluated for this coworker.",
          ],
        },
      ]),
    });
  });

  it.each(["software-platform", "retail-goods"])(
    "applies canonical leaf precedence to the leaf/category collision %s",
    (declaration) => {
      expect(
        projectCoworkerAvailability({
          install:
            declaration === "software-platform"
              ? { archetypeId: "software-platform", category: "software-platform" }
              : { archetypeId: "retail-goods", category: "retail-goods" },
          declarations: [declaration],
          readiness: readinessClear,
        }),
      ).toMatchObject({
        state: "available",
        label: "Available for your business type",
        matchLevel: "leaf",
      });
    },
  );

  it("does not reinterpret a leaf/category collision as category coverage for sibling leaves", () => {
    expect(
      projectCoworkerAvailability({
        install: { archetypeId: "florist", category: "retail-goods" },
        declarations: ["retail-goods"],
        readiness: readinessClear,
      }),
    ).toMatchObject({
      state: "not-available",
      label: "Not available for your business type",
      matchLevel: null,
    });
  });

  it("preserves malformed declaration evidence without exposing raw objects", () => {
    const projection = projectCoworkerAvailability({
      install: restaurant,
      declarations: ["food-hospitality", 42, { category: "software-platform" }],
    });

    expect(projection).toMatchObject({
      state: "coverage-not-defined",
      evidence: [
        { source: "storefront-archetype" },
        {
          source: "coworker-service-archetypes",
          values: ["food-hospitality", "<non-string:number>", "<non-string:object>"],
        },
      ],
    });
  });
});

describe("hasExactCoworkerArchetypeDeclaration", () => {
  it("preserves exact catalog matching without wildcard or empty-list semantics", () => {
    expect(hasExactCoworkerArchetypeDeclaration(["food-hospitality"], "food-hospitality")).toBe(true);
    expect(hasExactCoworkerArchetypeDeclaration(["*"], "food-hospitality")).toBe(false);
    expect(hasExactCoworkerArchetypeDeclaration([], "food-hospitality")).toBe(false);
  });
});

describe("resolveInstallArchetypeContext", () => {
  it("reads the leaf and category from the canonical storefront relation", async () => {
    const context = await resolveInstallArchetypeContext(
      {
        storefrontConfig: {
          findUnique: async (args) => {
            expect(args.where).toEqual({ organizationId: "org-restaurant" });
            return {
              archetype: restaurant,
            };
          },
        },
      },
      "org-restaurant",
    );

    expect(context).toEqual({
      install: restaurant,
      installResolutionReason: "The storefront business type was resolved.",
    });
  });

  it("returns an evidence-bearing unresolved result when the storefront cannot be read", async () => {
    const context = await resolveInstallArchetypeContext(
      {
        storefrontConfig: {
          findUnique: async () => {
            throw new Error("database unavailable");
          },
        },
      },
      "org-restaurant",
    );

    expect(context).toEqual({
      install: null,
      installResolutionReason: "The storefront business type could not be read.",
    });
  });

  it("composes read-failure evidence directly into the projection", async () => {
    const resolution = await resolveInstallArchetypeContext(
      {
        storefrontConfig: {
          findUnique: async () => {
            throw new Error("database unavailable");
          },
        },
      },
      "org-restaurant",
    );

    expect(
      projectCoworkerAvailability({
        ...resolution,
        declarations: ["food-hospitality"],
      }),
    ).toMatchObject({
      state: "coverage-not-defined",
      reason: "The storefront business type could not be read.",
      evidence: [
        {
          source: "storefront-archetype",
          values: ["The storefront business type could not be read."],
        },
      ],
    });
  });
});
