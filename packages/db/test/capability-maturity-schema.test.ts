import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "../src/client";
import { Prisma } from "../generated/client/client";

const TEST_PORTFOLIO_SLUG = "capability-maturity-test";
const TEST_TAXONOMY_NODE_ID = "capability-maturity-test/root";
const TEST_ASSESSMENT_A = "ACPM-TEST-RUNTIME";
const TEST_ASSESSMENT_B = "ACPM-TEST-GATEWAY";

async function clearTestRows() {
  await prisma.capabilityMaturityDependency.deleteMany({
    where: {
      OR: [
        { assessment: { assessmentId: { in: [TEST_ASSESSMENT_A, TEST_ASSESSMENT_B] } } },
        { dependency: { assessmentId: { in: [TEST_ASSESSMENT_A, TEST_ASSESSMENT_B] } } },
      ],
    },
  });
  await prisma.capabilityMaturityAssessment.deleteMany({
    where: { assessmentId: { in: [TEST_ASSESSMENT_A, TEST_ASSESSMENT_B] } },
  });
  await prisma.taxonomyNode.deleteMany({
    where: { nodeId: TEST_TAXONOMY_NODE_ID },
  });
  await prisma.portfolio.deleteMany({
    where: { slug: TEST_PORTFOLIO_SLUG },
  });
}

beforeEach(async () => {
  await clearTestRows();
});

afterAll(async () => {
  await clearTestRows();
  await prisma.$disconnect();
});

describe("CapabilityMaturityAssessment prisma schema", () => {
  it("exposes generated model delegates", () => {
    expect(Prisma.ModelName.CapabilityMaturityAssessment).toBe(
      "CapabilityMaturityAssessment",
    );
    expect(Prisma.ModelName.CapabilityMaturityDependency).toBe(
      "CapabilityMaturityDependency",
    );
    expect(prisma.capabilityMaturityAssessment).toBeDefined();
    expect(prisma.capabilityMaturityDependency).toBeDefined();
  });

  it("stores scored capability assessments and dependency edges", async () => {
    const portfolio = await prisma.portfolio.create({
      data: {
        slug: TEST_PORTFOLIO_SLUG,
        name: "Capability Maturity Test",
      },
    });
    const taxonomyNode = await prisma.taxonomyNode.create({
      data: {
        nodeId: TEST_TAXONOMY_NODE_ID,
        name: "Capability maturity test root",
        portfolioId: portfolio.id,
      },
    });

    const gateway = await prisma.capabilityMaturityAssessment.create({
      data: {
        assessmentId: TEST_ASSESSMENT_B,
        name: "MCP gateway",
        capabilityCategory: "tool_gateway",
        riskTier: "elevated",
        maturityScore: 3,
        strategicOwnership: "owned_core",
        portfolioId: portfolio.id,
        taxonomyNodeId: taxonomyNode.id,
        existingPrimitives: ["ToolExecution"],
        maturityGaps: ["scope UX"],
        evidenceSources: [],
        hiveMindSignals: [],
        kernelPrinciples: ["single-source-of-truth"],
      },
    });

    const runtime = await prisma.capabilityMaturityAssessment.create({
      data: {
        assessmentId: TEST_ASSESSMENT_A,
        name: "Runtime control",
        capabilityCategory: "runtime",
        riskTier: "elevated",
        maturityScore: 3,
        confidenceGrade: "claimed",
        strategicOwnership: "owned_core",
        vendorReplacementConfidence: "low",
        installScope: "canonical",
        productizationStatus: "not_eligible",
        portfolioId: portfolio.id,
        taxonomyNodeId: taxonomyNode.id,
        parityChecklistEvidence: [],
        existingPrimitives: ["Workroom"],
        maturityGaps: ["mandatory wrapper"],
        evidenceSources: [],
        hiveMindSignals: [],
        kernelPrinciples: ["architecture-over-shortcuts"],
        operationalSurface: "/portfolio/foundational",
        hasContinuousEvidence: false,
        assessedBy: "vitest",
      },
    });

    await prisma.capabilityMaturityDependency.create({
      data: {
        assessmentId: runtime.id,
        dependencyId: gateway.id,
      },
    });

    const loaded = await prisma.capabilityMaturityAssessment.findUniqueOrThrow({
      where: { assessmentId: TEST_ASSESSMENT_A },
      include: {
        portfolio: true,
        taxonomyNode: true,
        dependencies: { include: { dependency: true } },
      },
    });

    expect(loaded.portfolio.slug).toBe(TEST_PORTFOLIO_SLUG);
    expect(loaded.taxonomyNode?.nodeId).toBe(TEST_TAXONOMY_NODE_ID);
    expect(loaded.confidenceGrade).toBe("claimed");
    expect(loaded.installScope).toBe("canonical");
    expect(loaded.productizationStatus).toBe("not_eligible");
    expect(loaded.dependencies).toHaveLength(1);
    expect(loaded.dependencies[0]?.dependency.assessmentId).toBe(TEST_ASSESSMENT_B);
  });
});
