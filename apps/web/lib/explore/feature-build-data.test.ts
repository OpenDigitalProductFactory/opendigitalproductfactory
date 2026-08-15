import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  Prisma: {
    DbNull: { kind: "DbNull" },
  },
  prisma: {
    featureBuild: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    epic: {
      findMany: vi.fn(),
    },
    platformDevConfig: {
      findUnique: vi.fn(),
    },
    taxonomyNode: {
      findUnique: vi.fn(),
    },
    digitalProduct: {
      findMany: vi.fn(),
    },
    portfolio: {
      findUnique: vi.fn(),
    },
    businessContext: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@dpf/db", () => ({
  prisma: mocks.prisma,
  Prisma: mocks.Prisma,
}));

vi.mock("@/lib/decision-perspective/types", () => ({
  PLAN_READINESS_DOMAIN_CLASS: "plan-readiness",
}));

vi.mock("@/lib/decision-perspective/view-model", () => ({
  DECISION_INTERACTION_GATE_SELECT: { id: true },
  decisionInteractionRowToGateView: vi.fn(() => null),
}));

vi.mock("@/lib/brand/read", () => ({
  readBrandContext: vi.fn(async () => ({ structured: null, legacyMarkdown: null })),
}));

vi.mock("@/lib/design-intelligence", () => ({
  generateDesignSystem: vi.fn(() => "Generated design system"),
}));

import { Prisma, prisma } from "@dpf/db";
import {
  getExecutionEpicRollups,
  getFeatureBuildById,
  getFeatureBuildForContext,
  getFeatureBuilds,
} from "./feature-build-data";

describe("getFeatureBuilds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.featureBuild.findMany).mockResolvedValue([] as never);
  });

  it("loads only undecomposed top-level builds for the flat fleet rows", async () => {
    await getFeatureBuilds("user-phase5-flat-builds");

    expect(prisma.featureBuild.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          abandonedAt: null,
          phase: { not: "failed" },
          parentEpicId: null,
          supersededByEpicId: null,
        }),
      }),
    );
  });

  it("loads and projects only the business brief linked to the selected build", async () => {
    vi.mocked(prisma.featureBuild.findUnique).mockResolvedValue({
      id: "feature-build-row-a",
      buildId: "FB-CHANGE-A",
      title: "Make booking changes easier",
      phase: "plan",
      plan: null,
      brief: null,
      digitalProduct: null,
      originator: null,
      decisionInteractions: [],
      businessBuildBrief: {
        briefId: "BBB-CHANGE-A",
        status: "accepted",
        intakeSource: "user_conversation",
        capabilityPackId: null,
        businessOutcome: "Customers can change a booking without calling.",
        affectedPeople: [{ kind: "persona", label: "Customer" }],
        affectedWorkflow: "Booking changes",
        sourceEvidence: [],
        successSignals: ["Fewer change calls"],
        constraints: [],
        businessInterpretation: null,
        technicalInterpretation: {},
        riskProfile: {},
        openQuestions: [],
        confidence: "high",
      },
    } as never);

    const result = await getFeatureBuildById("FB-CHANGE-A");

    expect(prisma.featureBuild.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { buildId: "FB-CHANGE-A" },
        select: expect.objectContaining({
          businessBuildBrief: expect.objectContaining({ select: expect.any(Object) }),
        }),
      }),
    );
    expect(result?.businessBuildBrief).toMatchObject({
      briefId: "BBB-CHANGE-A",
      title: "Make booking changes easier",
      businessOutcome: "Customers can change a booking without calling.",
      affectedPeople: ["Customer"],
    });
  });
});

describe("getExecutionEpicRollups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads execution epics as the bridge across backlog items, child builds, and dependencies", async () => {
    vi.mocked(prisma.epic.findMany).mockResolvedValue([
      {
        id: "epic-row-1",
        epicId: "EP-TRUCK-STOCK",
        title: "Truck stock tracker",
        updatedAt: new Date("2026-05-25T12:00:00Z"),
        originatingBacklogItemId: "bi-row-origin",
        items: [
          { id: "bi-row-origin", itemId: "BI-ORIGIN", title: "Track truck parts", status: "in-progress" },
        ],
        featureBuilds: [
          {
            id: "fb-read-row",
            buildId: "FB-READ",
            title: "Truck and parts read",
            phase: "complete",
            childOrder: 1,
            updatedAt: new Date("2026-05-25T10:00:00Z"),
          },
          {
            id: "fb-usage-row",
            buildId: "FB-USAGE",
            title: "Record usage",
            phase: "plan",
            childOrder: 2,
            updatedAt: new Date("2026-05-25T11:00:00Z"),
          },
        ],
        dependencies: [
          {
            dependentBuildId: "fb-usage-row",
            dependsOnBuildId: "fb-read-row",
          },
        ],
      },
    ] as never);

    const rollups = await getExecutionEpicRollups("user-phase5-epics");

    expect(prisma.epic.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          designDoc: { not: Prisma.DbNull },
          featureBuilds: { some: {} },
        },
        orderBy: { updatedAt: "desc" },
      }),
    );
    expect(rollups[0]?.epicId).toBe("EP-TRUCK-STOCK");
    expect(rollups[0]?.backlogItems[0]?.itemId).toBe("BI-ORIGIN");
    expect(rollups[0]?.children.map((child) => child.buildId)).toEqual(["FB-READ", "FB-USAGE"]);
  });
});

describe("getFeatureBuildForContext taxonomy context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.platformDevConfig.findUnique).mockResolvedValue({ contributionMode: "private" } as never);
    vi.mocked(prisma.businessContext.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.digitalProduct.findMany).mockResolvedValue([
      { name: "Agent Runtime" },
      { name: "Agent Authority" },
    ] as never);
  });

  it("resolves confirmed taxonomy nodeId slugs to internal taxonomy rows before walking context", async () => {
    const confirmedNodeId = "foundational/platform_services/ai_and_agent_platform";
    vi.mocked(prisma.featureBuild.findUnique)
      .mockResolvedValueOnce({
        buildId: "FB-1",
        title: "Agent cost controls",
        phase: "ideate",
        brief: { title: "Agent cost controls" },
        designDoc: null,
        designReview: null,
        buildPlan: null,
        planReview: null,
        verificationOut: null,
        acceptanceMet: null,
        uxVerificationStatus: null,
        uxTestResults: null,
        plan: null,
        portfolioId: null,
        createdById: "user-1",
        scoutFindings: null,
        phaseHandoffs: [],
        taxonomyAttribution: {
          confirmedNodeId,
        },
      } as never);

    vi.mocked(prisma.taxonomyNode.findUnique).mockImplementation((async (input: unknown) => {
      const where = (input as { where: Record<string, string> }).where;
      if (where.nodeId === confirmedNodeId || where.id === "node-ai") {
        return { id: "node-ai", name: "AI and Agent Platform", parentId: "node-platform" } as never;
      }
      if (where.id === "node-platform") {
        return { id: "node-platform", name: "Platform Services", parentId: "node-foundational" } as never;
      }
      if (where.id === "node-foundational") {
        return { id: "node-foundational", name: "Foundational", parentId: null } as never;
      }
      return null as never;
    }) as never);

    const context = await getFeatureBuildForContext("FB-1", "user-1");

    expect(context?.taxonomyContext).toEqual({
      path: "Foundational > Platform Services > AI and Agent Platform",
      siblingProducts: ["Agent Runtime", "Agent Authority"],
    });
    expect(prisma.digitalProduct.findMany).toHaveBeenCalledWith({
      where: { taxonomyNodeId: "node-ai" },
      select: { name: true },
      take: 10,
    });
  });
});
