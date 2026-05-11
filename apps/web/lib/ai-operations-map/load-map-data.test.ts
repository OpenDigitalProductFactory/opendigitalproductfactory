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
    toolExecutionReceipt: {
      findMany: vi.fn(),
    },
    backlogItemActivity: {
      findMany: vi.fn(),
    },
    externalEvidenceRecord: {
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
    vi.mocked(prisma.toolExecutionReceipt.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.backlogItemActivity.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.externalEvidenceRecord.findMany).mockResolvedValue([] as never);

    const data = await loadOperationsMapData();

    expect(data.template.id).toBe("managed-service-provider");
    expect(data.agents[0].stationId).toBe("service-operations");
    expect(data.projections[0].location.stationId).toBe("service-operations");
    expect(data.recentWindowLabel).toBe("Last 40 records per evidence source");
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
    vi.mocked(prisma.toolExecutionReceipt.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.backlogItemActivity.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.externalEvidenceRecord.findMany).mockResolvedValue([] as never);

    const data = await loadOperationsMapData();

    expect(data.template.id).toBe("generic-value-chain");
    expect(data.agents).toEqual([]);
    expect(data.projections).toEqual([]);
  });

  it("loads and chronologically merges receipts, backlog evidence, and external evidence", async () => {
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.agent.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.toolExecution.findMany).mockResolvedValue([makeToolExecutionRow()] as never);
    vi.mocked(prisma.toolExecutionReceipt.findMany).mockResolvedValue([makeReceiptRow()] as never);
    vi.mocked(prisma.backlogItemActivity.findMany).mockResolvedValue([makeBacklogEvidenceRow()] as never);
    vi.mocked(prisma.externalEvidenceRecord.findMany).mockResolvedValue([makeExternalEvidenceRow()] as never);

    const data = await loadOperationsMapData();

    expect(data.projections.map((projection) => projection.source)).toEqual([
      "evidence-external",
      "evidence-backlog",
      "tool-receipt",
      "tool-execution",
    ]);
    expect(prisma.toolExecutionReceipt.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
      take: 40,
      select: {
        id: true,
        toolExecutionId: true,
        buildId: true,
        receiptKind: true,
        receiptStatus: true,
        executionStatus: true,
        expiresAt: true,
        createdAt: true,
        toolExecution: {
          select: {
            id: true,
            threadId: true,
            agentId: true,
            userId: true,
            toolName: true,
            success: true,
            executionMode: true,
            routeContext: true,
            durationMs: true,
            createdAt: true,
            auditClass: true,
            capabilityId: true,
            summary: true,
          },
        },
      },
    });
    expect(prisma.backlogItemActivity.findMany).toHaveBeenCalledWith({
      where: { kind: "evidence" },
      orderBy: { recordedAt: "desc" },
      take: 40,
      select: {
        id: true,
        backlogItemId: true,
        kind: true,
        summary: true,
        payload: true,
        recordedAt: true,
        recordedById: true,
        recordedByAgentId: true,
        toolExecutionId: true,
      },
    });
    expect(prisma.externalEvidenceRecord.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
      take: 40,
      select: {
        id: true,
        actorUserId: true,
        routeContext: true,
        operationType: true,
        target: true,
        provider: true,
        resultSummary: true,
        createdAt: true,
      },
    });
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

function makeReceiptRow() {
  return {
    id: "receipt-1",
    toolExecutionId: "tool-1",
    buildId: "build-1",
    receiptKind: "sandbox-output",
    receiptStatus: "valid",
    executionStatus: "completed",
    expiresAt: new Date("2026-05-11T12:00:00.000Z"),
    createdAt: new Date("2026-05-10T12:01:00.000Z"),
    toolExecution: makeToolExecutionRow(),
  };
}

function makeBacklogEvidenceRow() {
  return {
    id: "activity-1",
    backlogItemId: "BI-123",
    kind: "evidence",
    summary: "UX verification completed",
    payload: {},
    recordedAt: new Date("2026-05-10T12:02:00.000Z"),
    recordedById: "user-1",
    recordedByAgentId: "support-specialist",
    toolExecutionId: "tool-1",
  };
}

function makeExternalEvidenceRow() {
  return {
    id: "external-1",
    actorUserId: "user-1",
    routeContext: "release",
    operationType: "ci-check",
    target: "pull-request",
    provider: "github",
    resultSummary: "CI checks passed",
    createdAt: new Date("2026-05-10T12:03:00.000Z"),
  };
}
