import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    featureBuild: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    portfolio: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    taxonomyNode: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    taxonomyProposal: {
      create: vi.fn(),
    },
  },
  scoreTaxonomyCandidates: vi.fn(),
  flattenEnrichmentForScoring: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@dpf/db/discovery-attribution", () => ({
  scoreTaxonomyCandidates: mocks.scoreTaxonomyCandidates,
  flattenEnrichmentForScoring: mocks.flattenEnrichmentForScoring,
}));

import { prisma } from "@dpf/db";
import {
  attributeFeatureBuild,
  confirmFeatureTaxonomy,
  formatAttributionRecommendation,
} from "./feature-attribution";

describe("Build Studio taxonomy attribution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.flattenEnrichmentForScoring.mockReturnValue("");
    mocks.scoreTaxonomyCandidates.mockReturnValue([]);
    vi.mocked(prisma.featureBuild.update).mockResolvedValue({} as never);
    vi.mocked(prisma.portfolio.findMany).mockResolvedValue([
      { slug: "foundational", name: "Foundational" },
      { slug: "manufacturing_and_delivery", name: "Manufacturing & Delivery" },
    ] as never);
  });

  it("does not widen placement search when the brief has an invalid portfolio slug", async () => {
    vi.mocked(prisma.featureBuild.findUnique).mockResolvedValue({
      digitalProductId: null,
      digitalProduct: null,
    } as never);
    vi.mocked(prisma.portfolio.findUnique).mockResolvedValue(null as never);

    const attribution = await attributeFeatureBuild("FB-invalid-portfolio", {
      title: "Cost governance ledger",
      description: "Track AgentBudgetEvent records and enforce budget policy.",
      portfolioContext: "platform",
      acceptanceCriteria: [],
      targetRoles: ["Platform operator"],
      dataNeeds: "AgentBudgetEvent",
    });

    expect(attribution.method).toBe("invalid_portfolio");
    expect(attribution.confidence).toBe(0);
    expect((attribution as { invalidPortfolioContext?: string }).invalidPortfolioContext).toBe("platform");
    expect(attribution.candidates).toEqual([]);
    expect(prisma.taxonomyNode.findMany).not.toHaveBeenCalled();
    expect(formatAttributionRecommendation(attribution)).toContain("platform is not a valid portfolio");
  });

  it("canonicalizes a unique taxonomy node suffix when confirming placement", async () => {
    const canonicalNodeId = "foundational/platform_services/ai_and_agent_platform";
    vi.mocked(prisma.featureBuild.findUnique).mockResolvedValue({
      id: "fb-row-1",
      taxonomyAttribution: {
        method: "heuristic",
        confidence: 0.4,
        confirmedNodeId: null,
        topCandidate: null,
        candidates: [],
        proposedNewNode: null,
        attributedAt: "2026-05-21T00:00:00.000Z",
      },
    } as never);
    vi.mocked(prisma.taxonomyNode.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.taxonomyNode.findMany).mockResolvedValue([
      { id: "tax-row-1", nodeId: canonicalNodeId, name: "AI and Agent Platform" },
    ] as never);

    const result = await confirmFeatureTaxonomy("FB-1", "ai_and_agent_platform");

    expect(result.success).toBe(true);
    expect((result as { confirmedNodeId?: string }).confirmedNodeId).toBe(canonicalNodeId);
    expect(prisma.featureBuild.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { buildId: "FB-1" },
      data: {
        taxonomyAttribution: expect.objectContaining({
          method: "manual",
          confidence: 1,
          confirmedNodeId: canonicalNodeId,
        }),
      },
    }));
  });

  it("persists proposed taxonomy nodes into a review queue", async () => {
    const parentNodeId = "manufacturing_and_delivery/requirement_to_deploy/test_validate";
    vi.mocked(prisma.featureBuild.findUnique).mockResolvedValue({
      id: "fb-row-2",
      taxonomyAttribution: null,
    } as never);
    vi.mocked(prisma.taxonomyNode.findUnique).mockResolvedValue({
      id: "parent-row-1",
      nodeId: parentNodeId,
      name: "Test & Validate",
    } as never);
    vi.mocked(prisma.taxonomyProposal.create).mockResolvedValue({ id: "tp-1" } as never);

    const result = await confirmFeatureTaxonomy("FB-2", null, {
      parentNodeId,
      name: "Agent Cost Governance",
      description: "Budget policy and event-ledger controls for agent work.",
      rationale: "Existing test and deploy nodes are too execution-focused.",
    });

    expect(result.success).toBe(true);
    expect((result as { proposalId?: string }).proposalId).toBe("tp-1");
    expect((result as { confirmedNodeId?: string }).confirmedNodeId).toBe(parentNodeId);
    expect(prisma.taxonomyProposal.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        parentNodeId: "parent-row-1",
        featureBuildId: "fb-row-2",
        proposedName: "Agent Cost Governance",
        description: "Budget policy and event-ledger controls for agent work.",
        rationale: "Existing test and deploy nodes are too execution-focused.",
        status: "proposed",
      }),
      select: { id: true },
    });
    expect(prisma.featureBuild.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { buildId: "FB-2" },
      data: {
        taxonomyAttribution: expect.objectContaining({
          method: "ai_proposed",
          confirmedNodeId: parentNodeId,
          proposedNewNode: expect.objectContaining({ proposalId: "tp-1" }),
        }),
      },
    }));
  });
});
