import { describe, expect, it, vi } from "vitest";

import {
  getCapabilityMaturityForPortfolioNode,
  type CapabilityMaturityAssessmentRecord,
} from "./capability-maturity-data";

function assessment(
  overrides: Partial<CapabilityMaturityAssessmentRecord> = {},
): CapabilityMaturityAssessmentRecord {
  return {
    id: "a1",
    assessmentId: "ACPM-SAMPLE",
    name: "Sample capability",
    portfolioId: "port-1",
    taxonomyNodeId: "tax-1",
    capabilityCategory: "runtime",
    riskTier: "standard",
    maturityScore: 3,
    confidenceGrade: "claimed",
    installScope: "canonical",
    productizationStatus: "not_eligible",
    hasContinuousEvidence: false,
    evidenceFreshnessAt: null,
    lastGovernanceReviewAt: null,
    dependencies: [],
    ...overrides,
  };
}

describe("getCapabilityMaturityForPortfolioNode", () => {
  it("derives targets, effective maturity, lifecycle mode, and dependency block annotations", async () => {
    const gateway = assessment({
      id: "a2",
      assessmentId: "ACPM-MCP-TOOL-GOVERNANCE",
      name: "MCP gateway",
      capabilityCategory: "tool_gateway",
      riskTier: "elevated",
      maturityScore: 2,
      hasContinuousEvidence: true,
      evidenceFreshnessAt: new Date("2026-05-20T12:00:00.000Z"),
      taxonomyNodeId: "tax-gateway",
    });
    const prisma = {
      capabilityMaturityAssessment: {
        findMany: vi.fn().mockResolvedValue([
          assessment({
            id: "a1",
            assessmentId: "ACPM-RUNTIME-CONTROL",
            name: "Runtime control",
            capabilityCategory: "runtime",
            riskTier: "elevated",
            maturityScore: 4,
            hasContinuousEvidence: true,
            evidenceFreshnessAt: new Date("2026-05-20T12:00:00.000Z"),
            dependencies: [{ dependency: gateway }],
          }),
        ]),
      },
    };

    const result = await getCapabilityMaturityForPortfolioNode({
      prisma,
      portfolioId: "port-1",
      taxonomyNodeId: "tax-1",
      installScope: "canonical",
      now: new Date("2026-05-21T12:00:00.000Z"),
    });

    expect(prisma.capabilityMaturityAssessment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { portfolioId: "port-1", installScope: "canonical", taxonomyNodeId: "tax-1" },
      }),
    );
    expect(result.summary).toMatchObject({ total: 1, belowTarget: 1, investment: 1, operations: 0 });
    expect(result.rows[0]).toMatchObject({
      assessmentId: "ACPM-RUNTIME-CONTROL",
      confidenceGrade: "evidenced",
      mvpTargetScore: 4,
      effectiveMaturity: 2,
      lifecycleMode: "investment",
      productizationOverlay: "none",
      blockedByDependencies: [
        { assessmentId: "ACPM-MCP-TOOL-GOVERNANCE", name: "MCP gateway", effectiveMaturity: 2 },
      ],
    });
  });

  it("preserves operations lifecycle when productization overlay is candidate", async () => {
    const prisma = {
      capabilityMaturityAssessment: {
        findMany: vi.fn().mockResolvedValue([
          assessment({
            id: "b1",
            assessmentId: "ACPM-PRODUCTIZABLE",
            name: "Productizable capability",
            riskTier: "standard",
            maturityScore: 4,
            productizationStatus: "candidate",
            hasContinuousEvidence: true,
            evidenceFreshnessAt: new Date("2026-05-20T12:00:00.000Z"),
            lastGovernanceReviewAt: new Date("2026-05-15T12:00:00.000Z"),
          }),
        ]),
      },
    };

    const result = await getCapabilityMaturityForPortfolioNode({
      prisma,
      portfolioId: "port-1",
      installScope: "canonical",
      now: new Date("2026-05-21T12:00:00.000Z"),
    });

    expect(result.rows[0]).toMatchObject({
      confidenceGrade: "verified",
      lifecycleMode: "operations",
      productizationOverlay: "candidate",
    });
    expect(result.summary).toMatchObject({ total: 1, belowTarget: 0, investment: 0, operations: 1 });
  });

  it("demotes stale evidence by one maturity point without demoting claimed bootstrap rows", async () => {
    const prisma = {
      capabilityMaturityAssessment: {
        findMany: vi.fn().mockResolvedValue([
          assessment({
            id: "stale",
            assessmentId: "ACPM-STALE",
            name: "Stale evidence capability",
            maturityScore: 3,
            hasContinuousEvidence: true,
            evidenceFreshnessAt: new Date("2026-02-01T12:00:00.000Z"),
          }),
          assessment({
            id: "claimed",
            assessmentId: "ACPM-CLAIMED",
            name: "Claimed bootstrap capability",
            maturityScore: 3,
            hasContinuousEvidence: false,
            evidenceFreshnessAt: null,
            lastGovernanceReviewAt: null,
          }),
        ]),
      },
    };

    const result = await getCapabilityMaturityForPortfolioNode({
      prisma,
      portfolioId: "port-1",
      installScope: "canonical",
      now: new Date("2026-05-21T12:00:00.000Z"),
    });

    expect(result.rows.find((row) => row.assessmentId === "ACPM-STALE")).toMatchObject({
      confidenceGrade: "stale",
      effectiveMaturity: 2,
      lifecycleMode: "investment",
    });
    expect(result.rows.find((row) => row.assessmentId === "ACPM-CLAIMED")).toMatchObject({
      confidenceGrade: "claimed",
      effectiveMaturity: 3,
      lifecycleMode: "operations",
    });
  });

  it("rejects missing installScope so scores from different install scopes never aggregate silently", async () => {
    const prisma = { capabilityMaturityAssessment: { findMany: vi.fn().mockResolvedValue([]) } };

    await expect(
      getCapabilityMaturityForPortfolioNode({
        prisma,
        portfolioId: "port-1",
        installScope: undefined as never,
        now: new Date(),
      }),
    ).rejects.toThrow(/installScope/);

    expect(prisma.capabilityMaturityAssessment.findMany).not.toHaveBeenCalled();
  });
});
