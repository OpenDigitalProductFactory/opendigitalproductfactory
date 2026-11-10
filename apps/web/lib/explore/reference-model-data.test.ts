import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", () => ({
  cache: <T>(fn: T) => fn,
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    eaReferenceModel: { findMany: vi.fn(), findUnique: vi.fn() },
    eaReferenceAssessment: { findMany: vi.fn() },
    eaView: { findFirst: vi.fn() },
    storefrontConfig: { findFirst: vi.fn() },
    storefrontArchetype: { findUnique: vi.fn() },
  },
}));

import { prisma } from "@dpf/db";
import {
  getReferenceModelDetail,
  getReferenceModelsSummary,
  getReferenceModelPortfolioRollup,
} from "./ea-data";

const mockPrisma = prisma as unknown as {
  eaReferenceModel: { findMany: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
  eaReferenceAssessment: { findMany: ReturnType<typeof vi.fn> };
  eaView: { findFirst: ReturnType<typeof vi.fn> };
  storefrontConfig: { findFirst: ReturnType<typeof vi.fn> };
  storefrontArchetype: { findUnique: ReturnType<typeof vi.fn> };
};

/** Put the install on a declared archetype, the way setup leaves it. */
function installIs(category: string | null, archetypeId: string | null): void {
  mockPrisma.storefrontConfig.findFirst.mockResolvedValue({ archetypeId: "cuid-archetype" });
  mockPrisma.storefrontArchetype.findUnique.mockResolvedValue({ category, archetypeId });
}

beforeEach(() => {
  vi.clearAllMocks();
  installIs("nonprofits-and-community", "pet-rescue");
});

describe("getReferenceModelsSummary", () => {
  it("returns model rows with criterion counts", async () => {
    mockPrisma.eaReferenceModel.findMany.mockResolvedValue([
      {
        id: "rm-1",
        slug: "it4it_v3_0_1",
        name: "IT4IT",
        version: "3.0.1",
        status: "active",
        _count: { elements: 417, assessments: 12, proposals: 1 },
      },
    ]);

    const result = await getReferenceModelsSummary();

    expect(result).toEqual([
      expect.objectContaining({
        slug: "it4it_v3_0_1",
        name: "IT4IT",
        version: "3.0.1",
        criteriaCount: 417,
        applies: true,
      }),
    ]);
  });

  // BI-C44EAEE6: the seed scopes an industry model's element hierarchy to the
  // archetype, so on a pet rescue BIAN is correctly empty. The read used to pass
  // that through as "active with 0 criteria", which reads as broken.
  it("marks an industry model as not this install's, and says why", async () => {
    mockPrisma.eaReferenceModel.findMany.mockResolvedValue([
      {
        id: "rm-2",
        slug: "bian_service_landscape_v14_0_0",
        name: "BIAN Service Landscape",
        version: "14.0.0",
        status: "active",
        _count: { elements: 0, assessments: 0, proposals: 0 },
      },
    ]);

    const [model] = await getReferenceModelsSummary();

    expect(model?.applies).toBe(false);
    expect(model?.applicabilityReason).toContain("banking-financial-services");
    expect(model?.applicabilityReason).toContain("pet-rescue");
    // The catalogue row is still returned: it is kept on every install so an
    // operator can see the standard exists.
    expect(model?.slug).toBe("bian_service_landscape_v14_0_0");
  });

  it("applies the same industry model on an install that IS a bank", async () => {
    installIs("banking-financial-services", "community-bank");
    mockPrisma.eaReferenceModel.findMany.mockResolvedValue([
      {
        id: "rm-2",
        slug: "bian_service_landscape_v14_0_0",
        name: "BIAN Service Landscape",
        version: "14.0.0",
        status: "active",
        _count: { elements: 390, assessments: 4, proposals: 0 },
      },
    ]);

    const [model] = await getReferenceModelsSummary();

    expect(model?.applies).toBe(true);
    expect(model?.criteriaCount).toBe(390);
  });
});

describe("getReferenceModelPortfolioRollup", () => {
  it("builds per-portfolio status totals for one model", async () => {
    mockPrisma.eaReferenceModel.findUnique.mockResolvedValue({
      id: "rm-1",
      slug: "it4it_v3_0_1",
      name: "IT4IT",
      version: "3.0.1",
    });
    mockPrisma.eaReferenceAssessment.findMany.mockResolvedValue([
      {
        coverageStatus: "implemented",
        mvpIncluded: true,
        scope: { scopeRef: "foundational", name: "Foundational" },
        modelElement: { kind: "criterion" },
      },
      {
        coverageStatus: "partial",
        mvpIncluded: true,
        scope: { scopeRef: "foundational", name: "Foundational" },
        modelElement: { kind: "criterion" },
      },
      {
        coverageStatus: "planned",
        mvpIncluded: false,
        scope: { scopeRef: "for_employees", name: "For Employees" },
        modelElement: { kind: "criterion" },
      },
    ]);

    const result = await getReferenceModelPortfolioRollup("it4it_v3_0_1");

    expect(result.model.slug).toBe("it4it_v3_0_1");
    expect(result.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scopeRef: "foundational",
          counts: expect.objectContaining({
            implemented: 1,
            partial: 1,
          }),
          mvpIncludedCount: 2,
        }),
        expect.objectContaining({
          scopeRef: "for_employees",
          counts: expect.objectContaining({
            planned: 1,
          }),
          outOfMvpCount: 1,
        }),
      ])
    );
  });
});

describe("getReferenceModelDetail", () => {
  it("returns model metadata with artifacts and proposals", async () => {
    mockPrisma.eaReferenceModel.findUnique.mockResolvedValue({
      id: "rm-1",
      slug: "it4it_v3_0_1",
      name: "IT4IT",
      version: "3.0.1",
      status: "active",
      authorityType: "standard",
      description: "IT4IT reference model",
      artifacts: [
        { id: "a1", path: "docs/Reference/IT4IT v3.0.1.pdf", kind: "pdf", authority: "authoritative" },
      ],
      proposals: [
        { id: "p1", proposalType: "guidance", status: "proposed", proposedByType: "agent", reviewNotes: null },
      ],
    });
    mockPrisma.eaView.findFirst.mockResolvedValue({
      id: "view-1",
      name: "IT4IT value streams",
    });

    const result = await getReferenceModelDetail("it4it_v3_0_1");

    expect(result).toEqual(
      expect.objectContaining({
        slug: "it4it_v3_0_1",
        valueStreamProjection: expect.objectContaining({
          viewId: "view-1",
          isProjected: true,
        }),
        artifacts: expect.arrayContaining([
          expect.objectContaining({ kind: "pdf", authority: "authoritative" }),
        ]),
        proposals: expect.arrayContaining([
          expect.objectContaining({ proposalType: "guidance", status: "proposed" }),
        ]),
      })
    );
  });
});
