import { describe, expect, it } from "vitest";
import { COWORKER_SERVICE_CATALOG_SERVICE_SEEDS } from "@dpf/db/coworker-service-catalog-seed";

import {
  evaluateCoworkerServiceReadiness,
} from "./service-readiness";
import { VERIFIED_COWORKER_SERVICE_TOOL_NAMES } from "./registered-service-tools";
import { projectCoworkerDiscovery } from "@/lib/coworker-record/roster-presentation";

const service = {
  serviceId: "svc-marketing-campaign-execution",
  name: "Marketing campaign execution",
  backingSkillIds: [],
  backingToolNames: ["create_marketing_campaign"],
  backingGrantKeys: ["marketing_write"],
};

const readyEvidence = {
  assignedSkillIds: [],
  registeredToolNames: ["create_marketing_campaign"],
  heldGrantKeys: ["marketing_write"],
  routeReady: true,
  blockingCapabilityNeedCount: 0,
};

describe("evaluateCoworkerServiceReadiness", () => {
  it("evaluates clear when every advertised dependency is usable", () => {
    expect(evaluateCoworkerServiceReadiness(service, readyEvidence)).toEqual({
      status: "evaluated",
      blockers: [],
      missingPrerequisites: [],
    });
  });

  it("fails setup closed for missing skills, tools, grants, and tool authority", () => {
    const result = evaluateCoworkerServiceReadiness(
      {
        ...service,
        backingSkillIds: ["marketing-campaign-planning"],
        backingToolNames: [
          "create_marketing_campaign",
          "missing_marketing_tool",
        ],
        backingGrantKeys: ["marketing_read", "marketing_write"],
      },
      {
        ...readyEvidence,
        registeredToolNames: [
          "create_marketing_campaign",
          "get_campaign_plan",
        ],
        heldGrantKeys: ["marketing_read"],
      },
    );

    expect(result.status).toBe("evaluated");
    if (result.status === "evaluated") {
      expect(result.missingPrerequisites).toEqual(
        expect.arrayContaining([
          "Assign the advertised skills for Marketing campaign execution",
          "Register the advertised tools for Marketing campaign execution",
          "Grant the advertised permissions for Marketing campaign execution",
        ]),
      );
      expect(result.details).toEqual(
        expect.arrayContaining([
          "Missing skill: marketing-campaign-planning",
          "Unregistered tool: missing_marketing_tool",
          "Missing permission: marketing_write",
          "Tool permission denied: create_marketing_campaign",
        ]),
      );
    }
  });

  it("reports provider and governed capability blockers separately from setup", () => {
    const result = evaluateCoworkerServiceReadiness(service, {
      ...readyEvidence,
      routeReady: false,
      routeBlockerReason:
        "No configured model satisfies this coworker's routing requirements.",
      blockingCapabilityNeedCount: 2,
    });

    expect(result).toEqual({
      status: "evaluated",
      blockers: [
        "No configured model satisfies this coworker's routing requirements.",
        "2 blocking capability needs require review.",
      ],
      missingPrerequisites: [],
    });
  });

  it("keeps Customer Advisor fail-closed while its advertised backing is absent", () => {
    const result = evaluateCoworkerServiceReadiness(
      {
        serviceId: "svc-customer-sales-intake",
        name: "Customer sales intake",
        backingSkillIds: ["customer-intake-triage"],
        backingToolNames: ["create_customer_case"],
        backingGrantKeys: [],
      },
      {
        ...readyEvidence,
        registeredToolNames: [],
        heldGrantKeys: [],
      },
    );

    expect(result.status).toBe("evaluated");
    if (result.status === "evaluated") {
      expect(result.missingPrerequisites).toEqual(
        expect.arrayContaining([
          "Assign the advertised skills for Customer sales intake",
          "Register the advertised tools for Customer sales intake",
        ]),
      );
    }
  });

  it("keeps the canonical Customer Advisor declaration non-conversational with its real missing backing", () => {
    const canonical = COWORKER_SERVICE_CATALOG_SERVICE_SEEDS.find(
      (candidate) =>
        candidate.serviceId === "svc-customer-sales-intake",
    );
    expect(canonical).toBeDefined();
    if (!canonical) return;

    const readiness = evaluateCoworkerServiceReadiness(canonical, {
      assignedSkillIds: [],
      registeredToolNames: VERIFIED_COWORKER_SERVICE_TOOL_NAMES,
      heldGrantKeys: [],
      routeReady: true,
      blockingCapabilityNeedCount: 0,
    });
    expect(readiness.status).toBe("evaluated");
    if (readiness.status === "evaluated") {
      expect(readiness.missingPrerequisites).toEqual(
        expect.arrayContaining([
          `Assign the advertised skills for ${canonical.name}`,
          `Register the advertised tools for ${canonical.name}`,
          `Grant the advertised permissions for ${canonical.name}`,
        ]),
      );
    }

    const discovery = projectCoworkerDiscovery({
      agentDescription: "Handles customer requests.",
      services: [
        {
          ...canonical,
          portfolio: {
            slug: "products_and_services_sold",
            name: "Products and services sold",
          },
        },
      ],
      install: {
        install: {
          archetypeId: "restaurant",
          category: "food-hospitality",
        },
        installResolutionReason: "The storefront business type was resolved.",
      },
      readinessByServiceId: new Map([[canonical.serviceId, readiness]]),
    });

    expect(discovery.availability.state).toBe("coverage-not-defined");
    expect(discovery.canStartConversation).toBe(false);
  });

  it("fails closed when backing declarations are malformed or empty", () => {
    const malformed = evaluateCoworkerServiceReadiness(
      {
        ...service,
        backingSkillIds: "marketing-campaign-planning",
        backingToolNames: null,
        backingGrantKeys: {},
      },
      readyEvidence,
    );
    const empty = evaluateCoworkerServiceReadiness(
      {
        ...service,
        backingSkillIds: [],
        backingToolNames: [],
        backingGrantKeys: [],
      },
      readyEvidence,
    );

    expect(malformed.status).toBe("evaluated");
    expect(empty.status).toBe("evaluated");
    if (malformed.status === "evaluated" && empty.status === "evaluated") {
      expect(malformed.missingPrerequisites).toContain(
        "Repair the advertised backing for Marketing campaign execution",
      );
      expect(empty.missingPrerequisites).toContain(
        "Define executable backing for Marketing campaign execution",
      );
    }
  });
});
