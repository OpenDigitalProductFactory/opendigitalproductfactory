import { describe, expect, it } from "vitest";

import {
  capabilityNeedBlocksCoworker,
  projectCoworkerDiscovery,
  projectCoworkerInteraction,
  projectCoworkerOwnerAreas,
  projectCoworkerServiceAuthority,
  projectRosterAvailability,
  projectRosterServiceAvailability,
  rosterPlainJob,
  rosterWorkSearchText,
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
    hitlTier: 1,
    authorityBoundary: "proposal-only",
    availabilityScope: "external",
    personas: ["customer"],
    archetypes: ["restaurant"],
    backingSkillIds: [],
    backingToolNames: [],
    backingGrantKeys: [],
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

  it("uses one ready applicable service without blessing an unresolved sibling", () => {
    const marketing = service({
      serviceId: "svc-marketing-campaign-execution",
      name: "Marketing campaign execution",
      archetypes: ["food-hospitality"],
    });
    const unresolvedSibling = service({
      serviceId: "svc-marketing-ab-testing",
      name: "Marketing A/B variant testing",
      archetypes: ["food-hospitality"],
    });
    const projection = projectRosterAvailability({
      services: [unresolvedSibling, marketing],
      install: restaurantInstall,
      readinessByServiceId: new Map([
        [
          marketing.serviceId,
          {
            status: "evaluated",
            blockers: [],
            missingPrerequisites: [],
          },
        ],
      ]),
    });

    expect(projection.state).toBe("available");
    expect(projection.evidence).toContainEqual({
      source: "coworker-service",
      values: [
        "svc-marketing-campaign-execution",
        "Marketing campaign execution",
      ],
    });
    const byService = projectRosterServiceAvailability({
      services: [unresolvedSibling, marketing],
      install: restaurantInstall,
      readinessByServiceId: new Map([
        [
          marketing.serviceId,
          {
            status: "evaluated",
            blockers: [],
            missingPrerequisites: [],
          },
        ],
      ]),
    });
    expect(byService).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          serviceId: "svc-marketing-campaign-execution",
          availability: expect.objectContaining({ state: "available" }),
        }),
        expect.objectContaining({
          serviceId: "svc-marketing-ab-testing",
          availability: expect.objectContaining({
            state: "coverage-not-defined",
          }),
        }),
      ]),
    );
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
        services: [service({ archetypes: ["software-platform"] })],
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
    expect(projection.availability.matchLevel).toBe("leaf");
    expect(projection.canStartConversation).toBe(false);
    expect(projection.workSearchText).toContain("Customer intake");
  });

  it("does not offer conversation when applicability does not match", () => {
    const projection = projectCoworkerDiscovery({
      agentDescription: "Authored work description.",
      services: [service({ archetypes: ["software-platform"] })],
      install: restaurantInstall,
    });

    expect(projection.availability.state).toBe("not-available");
    expect(projection.canStartConversation).toBe(false);
  });

  it("describes interaction for the service that actually makes the coworker available", () => {
    const readyInternal = service({
      serviceId: "svc-marketing-campaign-execution",
      name: "Marketing campaign execution",
      availabilityScope: "internal",
      personas: ["operator"],
      archetypes: ["food-hospitality"],
    });
    const unavailableCustomer = service({
      serviceId: "svc-marketing-customer-outreach",
      name: "Marketing customer outreach",
      availabilityScope: "external",
      personas: ["customer"],
      archetypes: ["software-platform"],
    });

    const projection = projectCoworkerDiscovery({
      agentDescription: "Plans and runs marketing campaigns.",
      services: [unavailableCustomer, readyInternal],
      install: restaurantInstall,
      readinessByServiceId: new Map([
        [
          readyInternal.serviceId,
          {
            status: "evaluated",
            blockers: [],
            missingPrerequisites: [],
          },
        ],
      ]),
    });

    expect(projection.availability.state).toBe("available");
    expect(projection.interaction).toEqual({
      scopes: ["internal-only"],
      labels: ["Internal only"],
    });
  });

  it("retains interaction from every service tied for the winning availability state", () => {
    const readyInternal = service({
      serviceId: "svc-marketing-campaign-execution",
      availabilityScope: "internal",
      personas: ["operator"],
      archetypes: ["food-hospitality"],
    });
    const readyCustomer = service({
      serviceId: "svc-marketing-customer-outreach",
      availabilityScope: "external",
      personas: ["customer"],
      archetypes: ["food-hospitality"],
    });
    const ready = {
      status: "evaluated" as const,
      blockers: [],
      missingPrerequisites: [],
    };

    const projection = projectCoworkerDiscovery({
      agentDescription: "Plans and runs marketing campaigns.",
      services: [readyInternal, readyCustomer],
      install: restaurantInstall,
      readinessByServiceId: new Map([
        [readyInternal.serviceId, ready],
        [readyCustomer.serviceId, ready],
      ]),
    });

    expect(projection.interaction.scopes).toEqual([
      "talks-to-customers",
      "internal-only",
    ]);
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

describe("service discovery evidence", () => {
  it("indexes the names and summaries of every active service", () => {
    expect(
      rosterWorkSearchText([
        service(),
        service({
          serviceId: "svc-battlecards",
          name: "Competitive battlecards",
          summary: "Prepares competitor positioning.",
        }),
      ]),
    ).toContain("Competitive battlecards Prepares competitor positioning.");
  });

  it("uses the strictest active service authority for the owner headline", () => {
    const projection = projectCoworkerServiceAuthority({
      agent: {
        agentId: "marketing-specialist",
        hitlTierDefault: 3,
      },
      governance: { state: "not-configured" },
      services: [
        service({
          serviceId: "svc-autonomous",
          authorityBoundary: "autonomous-allowed",
          hitlTier: 3,
        }),
        service({
          serviceId: "svc-proposal",
          authorityBoundary: "proposal-only",
          hitlTier: 2,
        }),
      ],
    });

    expect(projection.state).toBe("resolved");
    if (projection.state === "resolved") {
      expect(projection.level).toBe("proposal-only");
      expect(projection.winner.ref).toBe("svc-proposal");
    }
  });
});
