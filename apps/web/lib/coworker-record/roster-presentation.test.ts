import { describe, expect, it } from "vitest";

import {
  capabilityNeedBlocksCoworker,
  projectCoworkerDiscovery,
  projectCoworkerInteraction,
  projectCoworkerOwnerAreas,
  projectRosterAvailability,
  rosterPlainJob,
  type RosterServiceEvidence,
} from "./roster-presentation";

const restaurantInstall = {
  install: {
    archetypeId: "restaurant",
    category: "food-hospitality",
  },
  installResolutionReason: "The storefront business type was resolved.",
};

function service(
  over: Partial<RosterServiceEvidence> = {},
): RosterServiceEvidence {
  return {
    serviceId: "svc-customer",
    name: "Customer intake",
    summary: "Handles customer intake and follow-up.",
    status: "active",
    availabilityScope: "external",
    personas: ["customer"],
    archetypes: ["restaurant"],
    metadata: {},
    portfolio: {
      slug: "products_and_services_sold",
      name: "Products and services sold",
    },
    ...over,
  };
}

describe("projectCoworkerOwnerAreas", () => {
  it("uses explicit service ownership and leaves unassigned work in Other", () => {
    expect(projectCoworkerOwnerAreas([service()]).primary.key).toBe(
      "products_and_services_sold",
    );
    expect(
      projectCoworkerOwnerAreas([service({ portfolio: null })]).primary.key,
    ).toBe("other");
  });

  it("selects the customer-inward area first and retains every service area", () => {
    const projection = projectCoworkerOwnerAreas([
      service({
        serviceId: "svc-platform",
        portfolio: { slug: "foundational", name: "Foundational" },
      }),
      service(),
    ]);

    expect(projection.primary.key).toBe("products_and_services_sold");
    expect(projection.all.map((area) => area.key)).toEqual([
      "products_and_services_sold",
      "foundational",
    ]);
  });
});

describe("projectCoworkerInteraction", () => {
  it("preserves customer and partner interaction together", () => {
    expect(
      projectCoworkerInteraction([
        service({ personas: ["customer", "partner"] }),
      ]),
    ).toEqual({
      scopes: ["talks-to-customers", "works-with-partners"],
      labels: ["Talks to customers", "Works with partners"],
    });
  });

  it("distinguishes internal and undefined interaction", () => {
    expect(
      projectCoworkerInteraction([
        service({
          availabilityScope: "internal",
          personas: ["operator"],
        }),
      ]).scopes,
    ).toEqual(["internal-only"]);
    expect(projectCoworkerInteraction([]).scopes).toEqual(["not-defined"]);
  });
});

describe("projectRosterAvailability", () => {
  it("treats blocked needs as blockers and submitted needs as improvement work", () => {
    expect(capabilityNeedBlocksCoworker("blocked")).toBe(true);
    expect(capabilityNeedBlocksCoworker("submitted")).toBe(false);
  });

  it("stays unknown until readiness is explicitly evaluated", () => {
    expect(
      projectRosterAvailability({
        services: [service()],
        install: restaurantInstall,
      }).state,
    ).toBe("coverage-not-defined");
  });

  it("allows work entry only from matching and evaluated service evidence", () => {
    expect(
      projectRosterAvailability({
        services: [service()],
        install: restaurantInstall,
        readiness: {
          status: "evaluated",
          blockers: [],
          missingPrerequisites: [],
        },
      }).state,
    ).toBe("available");
  });

  it("projects explicit blockers and missing setup prerequisites", () => {
    expect(
      projectRosterAvailability({
        services: [service()],
        install: restaurantInstall,
        readiness: {
          status: "evaluated",
          blockers: ["Provider credential expired"],
          missingPrerequisites: [],
        },
      }).state,
    ).toBe("needs-attention");
    expect(
      projectRosterAvailability({
        services: [service()],
        install: restaurantInstall,
        readiness: {
          status: "evaluated",
          blockers: [],
          missingPrerequisites: ["Connect customer records"],
        },
      }).state,
    ).toBe("setup-needed");
  });

  it("does not treat absent or mismatched declarations as universal support", () => {
    expect(
      projectRosterAvailability({
        services: [],
        install: restaurantInstall,
      }).state,
    ).toBe("coverage-not-defined");
    expect(
      projectRosterAvailability({
        services: [service({ archetypes: ["software-and-platforms"] })],
        install: restaurantInstall,
      }).state,
    ).toBe("not-available");
  });
});

describe("projectCoworkerDiscovery", () => {
  it("projects the shared owner-facing record deterministically", () => {
    const projection = projectCoworkerDiscovery({
      agentDescription: "Authored work description.",
      services: [service()],
      install: restaurantInstall,
    });

    expect(projection.area.key).toBe("products_and_services_sold");
    expect(projection.plainJob).toBe("Authored work description.");
    expect(projection.interaction.scopes).toContain("talks-to-customers");
    expect(projection.availability.state).toBe("coverage-not-defined");
  });
});

describe("rosterPlainJob", () => {
  it("prefers an aggregate declared service over authored persona copy", () => {
    expect(
      rosterPlainJob("Long technical persona description", [
        service({ summary: "A narrow task." }),
        service({
          serviceId: "svc-aggregate",
          summary: "Runs campaigns from plan through measured results.",
          metadata: { aggregate: true },
        }),
      ]),
    ).toBe("Runs campaigns from plan through measured results.");
  });

  it("uses authored description instead of an arbitrary active service", () => {
    expect(
      rosterPlainJob("Authored work description.", [
        service({ summary: "A narrow service." }),
      ]),
    ).toBe("Authored work description.");
  });

  it("keeps an explicit unknown when neither source defines the job", () => {
    expect(rosterPlainJob(null, [])).toBe("Work description not defined.");
  });
});
