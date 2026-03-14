import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockReadFile, mockSheetToJson } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockSheetToJson: vi.fn(),
}));

vi.mock("./client.js", () => ({
  prisma: {
    portfolio: { findMany: vi.fn() },
    eaAssessmentScope: { upsert: vi.fn() },
    eaReferenceModel: { upsert: vi.fn() },
    eaReferenceModelArtifact: { upsert: vi.fn() },
    eaReferenceModelElement: { upsert: vi.fn() },
  },
}));

vi.mock("xlsx", () => ({
  readFile: mockReadFile,
  utils: {
    sheet_to_json: mockSheetToJson,
  },
}));

import { prisma } from "./client.js";
import { seedEaReferenceModels } from "./seed-ea-reference-models.js";

const mockPrisma = prisma as unknown as {
  portfolio: { findMany: ReturnType<typeof vi.fn> };
  eaAssessmentScope: { upsert: ReturnType<typeof vi.fn> };
  eaReferenceModel: { upsert: ReturnType<typeof vi.fn> };
  eaReferenceModelArtifact: { upsert: ReturnType<typeof vi.fn> };
  eaReferenceModelElement: { upsert: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.portfolio.findMany.mockResolvedValue([
    { id: "p1", slug: "foundational", name: "Foundational" },
    { id: "p2", slug: "manufacturing_and_delivery", name: "Manufacture and Delivery" },
    { id: "p3", slug: "for_employees", name: "For Employees" },
    { id: "p4", slug: "products_and_services_sold", name: "Products and Services Sold" },
  ]);
  mockPrisma.eaAssessmentScope.upsert.mockResolvedValue({});
  mockPrisma.eaReferenceModel.upsert.mockResolvedValue({ id: "model-1" });
  mockPrisma.eaReferenceModelArtifact.upsert.mockResolvedValue({});
  mockPrisma.eaReferenceModelElement.upsert.mockImplementation(async (args: { where: { modelId_slug: { slug: string } } }) => ({
    id: `el-${args.where.modelId_slug.slug}`,
  }));

  mockReadFile.mockReturnValue({
    SheetNames: ["IT4IT Functional Criteria", "Value Stream Activities", "FC Participation Matrix"],
    Sheets: {
      "IT4IT Functional Criteria": {},
      "Value Stream Activities": {},
      "FC Participation Matrix": {},
    },
  });

  mockSheetToJson
    .mockReturnValueOnce([
      {
        "Level 1: Capability Group": "Strategy to Portfolio",
        "Level 2: Function": "Strategy Function",
        "Level 3: Functional Component": "Policy",
        "Functional Criteria": "Shall align and map to Enterprise Architecture",
        "Reference Section": "6.1.1",
      },
    ])
    .mockReturnValueOnce([
      {
        "Value Stream": "Evaluate",
        "Value Stream Stage": "Gather Influencers Stage",
        "Activity Criteria": "Shall define Strategic Themes and Strategic Objectives",
        "Reference Section": "5.1.2",
      },
    ])
    .mockReturnValueOnce([
      {
        "Value Stream": "Evaluate",
        "Value Stream Stage": "Gather Influencers Stage",
        Ref: "5.1.2",
        Policy: "●",
      },
    ]);
});

describe("seedEaReferenceModels", () => {
  it("seeds the four portfolio assessment scopes and the IT4IT model", async () => {
    await seedEaReferenceModels();

    expect(mockPrisma.eaAssessmentScope.upsert).toHaveBeenCalledTimes(4);
    expect(mockPrisma.eaAssessmentScope.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { scopeType_scopeRef: { scopeType: "portfolio", scopeRef: "foundational" } },
      })
    );

    expect(mockPrisma.eaReferenceModel.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { slug: "it4it_v3_0_1" },
      })
    );
  });
});
