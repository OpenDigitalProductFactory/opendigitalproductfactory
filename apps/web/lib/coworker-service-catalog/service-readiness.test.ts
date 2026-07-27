import { describe, expect, it } from "vitest";

import {
  evaluateCoworkerServiceReadiness,
  hasHealthyCoworkerProvider,
} from "./service-readiness";

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
  providerHealthy: true,
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
      providerHealthy: false,
      blockingCapabilityNeedCount: 2,
    });

    expect(result).toEqual({
      status: "evaluated",
      blockers: [
        "No active tool-capable AI provider is available.",
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

describe("hasHealthyCoworkerProvider", () => {
  const providers = [
    {
      providerId: "openai",
      status: "active",
      activeToolModelCount: 1,
    },
    {
      providerId: "degraded",
      status: "degraded",
      activeToolModelCount: 1,
    },
  ];

  it("requires positive active tool-capable routing evidence", () => {
    expect(hasHealthyCoworkerProvider(null, [])).toBe(false);
    expect(
      hasHealthyCoworkerProvider(null, [
        {
          providerId: "openai",
          status: "active",
          activeToolModelCount: 0,
        },
      ]),
    ).toBe(false);
    expect(hasHealthyCoworkerProvider(null, providers)).toBe(true);
  });

  it("requires the pinned provider itself to be eligible", () => {
    expect(hasHealthyCoworkerProvider("openai", providers)).toBe(true);
    expect(hasHealthyCoworkerProvider("degraded", providers)).toBe(false);
    expect(hasHealthyCoworkerProvider("missing", providers)).toBe(false);
  });
});
