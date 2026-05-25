import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  CAPABILITY_INSTALL_SCOPES,
  CAPABILITY_MATURITY_CONFIDENCE_GRADES,
  CAPABILITY_MATURITY_RISK_TIERS,
} from "./capability-maturity";
import {
  loadAgentControlPlaneMaturitySeedRows,
  seedAgentControlPlaneMaturity,
  validateAgentControlPlaneMaturitySeedRows,
  type AgentControlPlaneMaturitySeedRow,
} from "./seed-agent-control-plane-maturity";

function seedRows(): AgentControlPlaneMaturitySeedRow[] {
  return loadAgentControlPlaneMaturitySeedRows();
}

function principleDir(slugs: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "dpf-principles-"));
  for (const slug of slugs) {
    writeFileSync(join(dir, `${slug}.md`), `# ${slug}\n`);
  }
  return dir;
}

function baseRow(overrides: Partial<AgentControlPlaneMaturitySeedRow> = {}): AgentControlPlaneMaturitySeedRow {
  return {
    assessmentId: "ACPM-TEST-A",
    name: "Test maturity",
    portfolioSlug: "foundational",
    taxonomyNodePath: "foundational/platform_services",
    capabilityCategory: "runtime",
    riskTier: "standard",
    maturityScore: 2,
    confidenceGrade: "claimed",
    strategicOwnership: "owned_core",
    vendorReplacementConfidence: "low",
    installScope: "canonical",
    productizationStatus: "not_eligible",
    existingPrimitives: [],
    maturityGaps: [],
    evidenceSources: [],
    hiveMindSignals: [],
    kernelPrinciples: ["never-fabricate"],
    operationalSurface: "/platform/ai/authority",
    dependsOnAssessmentIds: [],
    ...overrides,
  };
}

type AssessmentUpsertArgs = {
  where: { assessmentId: string };
  create: Record<string, unknown>;
  update: Record<string, unknown>;
};

describe("agent control plane maturity seed", () => {
  it("uses stable assessment ids and canonical claimed seed rows", () => {
    const rows = seedRows();

    expect(rows).toHaveLength(11);
    for (const row of rows) {
      expect(row.assessmentId).toMatch(/^ACPM-[A-Z0-9-]+$/);
      expect(CAPABILITY_MATURITY_RISK_TIERS).toContain(row.riskTier);
      expect(CAPABILITY_INSTALL_SCOPES).toContain(row.installScope);
      expect(row.installScope).toBe("canonical");
      expect(CAPABILITY_MATURITY_CONFIDENCE_GRADES).toContain(row.confidenceGrade);
      expect(row.confidenceGrade).toBe("claimed");
    }
  });

  it("does not persist derived target or effective maturity fields in seed rows", () => {
    for (const row of seedRows()) {
      expect(row).not.toHaveProperty("mvpTargetScore");
      expect(row).not.toHaveProperty("effectiveMaturity");
    }
  });

  it("validates dependency cycles and kernel principle references before writes", () => {
    const dir = principleDir(["never-fabricate"]);
    try {
      expect(() =>
        validateAgentControlPlaneMaturitySeedRows(
          [
            baseRow({ assessmentId: "ACPM-TEST-A", dependsOnAssessmentIds: ["ACPM-TEST-B"] }),
            baseRow({ assessmentId: "ACPM-TEST-B", dependsOnAssessmentIds: ["ACPM-TEST-A"] }),
          ],
          { kernelPrinciplesDir: dir },
        ),
      ).toThrow(/dependency cycle/i);

      expect(() =>
        validateAgentControlPlaneMaturitySeedRows(
          [baseRow({ kernelPrinciples: ["missing-principle"] })],
          { kernelPrinciplesDir: dir },
        ),
      ).toThrow(/Unknown kernelPrinciples slugs/);

      expect(() =>
        validateAgentControlPlaneMaturitySeedRows(
          [baseRow({ dependsOnAssessmentIds: ["ACPM-UNKNOWN"] })],
          { kernelPrinciplesDir: dir },
        ),
      ).toThrow(/Unknown maturity dependency/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("upserts assessments and rewrites dependency edges idempotently", async () => {
    const rows = seedRows();
    const portfolioIds = new Map([
      ["foundational", "portfolio-foundational"],
      ["manufacturing_and_delivery", "portfolio-manufacturing"],
      ["for_employees", "portfolio-employees"],
      ["products_and_services_sold", "portfolio-products"],
    ]);
    const assessmentDbIds = new Map(rows.map((row) => [row.assessmentId, `db-${row.assessmentId}`]));

    const prisma = {
      portfolio: {
        findUnique: vi.fn(async ({ where }: { where: { slug: string } }) => {
          const id = portfolioIds.get(where.slug);
          return id ? { id } : null;
        }),
      },
      taxonomyNode: {
        findUnique: vi.fn(async ({ where }: { where: { nodeId: string } }) => ({
          id: `node-${where.nodeId}`,
        })),
      },
      capabilityMaturityAssessment: {
        upsert: vi.fn(async ({ where }: AssessmentUpsertArgs) => ({
          id: assessmentDbIds.get(where.assessmentId),
        })),
      },
      capabilityMaturityDependency: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
        create: vi.fn(async () => ({})),
      },
    };

    await seedAgentControlPlaneMaturity(prisma as never, {
      kernelPrincipleSlugs: new Set(rows.flatMap((row) => row.kernelPrinciples)),
    });

    expect(prisma.capabilityMaturityAssessment.upsert).toHaveBeenCalledTimes(11);
    const upsertCalls = prisma.capabilityMaturityAssessment.upsert.mock.calls as Array<[AssessmentUpsertArgs]>;
    const identityUpsert = upsertCalls.find(
      ([args]) => args.where.assessmentId === "ACPM-IDENTITY-AUTHORITY",
    )?.[0];
    expect(identityUpsert?.create).not.toHaveProperty("mvpTargetScore");
    expect(identityUpsert?.create).not.toHaveProperty("effectiveMaturity");
    expect(prisma.capabilityMaturityDependency.deleteMany).toHaveBeenCalledWith({
      where: { assessmentId: { in: [...assessmentDbIds.values()] } },
    });
    expect(prisma.capabilityMaturityDependency.create).toHaveBeenCalledTimes(
      rows.reduce((sum, row) => sum + row.dependsOnAssessmentIds.length, 0),
    );
    expect(prisma.capabilityMaturityDependency.create).toHaveBeenCalledWith({
      data: {
        assessmentId: "db-ACPM-MCP-TOOL-GOVERNANCE",
        dependencyId: "db-ACPM-IDENTITY-AUTHORITY",
      },
    });
  });
});
