import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    storefrontConfig: {
      findFirst: vi.fn(),
    },
    agent: {
      findMany: vi.fn(),
    },
    toolExecution: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";
import { loadOperationsMapData } from "./load-map-data";

describe("loadOperationsMapData", () => {
  it("selects the map template from StorefrontConfig archetype truth", async () => {
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue({
      archetype: {
        archetypeId: "it-managed-services",
        activationProfile: {
          profileType: "managed-service-provider",
          modules: ["customer-estate", "service-agreements", "billing-readiness", "service-operations"],
        },
      },
    } as never);
    vi.mocked(prisma.agent.findMany).mockResolvedValue([makeAgentRow()] as never);
    vi.mocked(prisma.toolExecution.findMany).mockResolvedValue([makeToolExecutionRow()] as never);

    const data = await loadOperationsMapData();

    expect(data.template.id).toBe("managed-service-provider");
    expect(data.agents[0].stationId).toBe("service-operations");
    expect(data.projections[0].location.stationId).toBe("service-operations");
    expect(data.recentWindowLabel).toBe("Last 40 tool executions");
    expect(prisma.storefrontConfig.findFirst).toHaveBeenCalledWith({
      include: {
        archetype: {
          select: {
            archetypeId: true,
            activationProfile: true,
          },
        },
      },
    });
  });

  it("falls back to the generic value-chain map when no storefront archetype is configured", async () => {
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.agent.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.toolExecution.findMany).mockResolvedValue([] as never);

    const data = await loadOperationsMapData();

    expect(data.template.id).toBe("generic-value-chain");
    expect(data.agents).toEqual([]);
    expect(data.projections).toEqual([]);
  });
});

function makeAgentRow() {
  return {
    id: "agent-db-1",
    agentId: "support-specialist",
    slugId: "support-specialist",
    name: "Support Specialist",
    tier: 2,
    type: "specialist",
    description: "Handles service operations.",
    status: "active",
    valueStream: "operate",
    it4itSections: [],
    sensitivity: "internal",
    lifecycleStage: "production",
    _count: { skills: 2, toolGrants: 4 },
  };
}

function makeToolExecutionRow() {
  return {
    id: "tool-1",
    threadId: "thread-1",
    agentId: "support-specialist",
    userId: "user-1",
    toolName: "diagnose_customer_estate",
    success: true,
    executionMode: "immediate",
    routeContext: "service-operations",
    durationMs: 80,
    createdAt: new Date("2026-05-10T12:00:00.000Z"),
    auditClass: "journal",
    capabilityId: "platform:diagnose_customer_estate",
    summary: "Checked service health",
  };
}
