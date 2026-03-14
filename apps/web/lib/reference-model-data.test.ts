import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", () => ({
  cache: <T>(fn: T) => fn,
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    eaReferenceModel: { findMany: vi.fn(), findUnique: vi.fn() },
    eaReferenceAssessment: { findMany: vi.fn() },
    eaView: { findFirst: vi.fn() },
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
};

beforeEach(() => {
  vi.clearAllMocks();
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
      }),
    ]);
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
