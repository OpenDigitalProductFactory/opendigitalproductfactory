import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockReadWorkbook } = vi.hoisted(() => ({
  mockReadWorkbook: vi.fn(),
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

vi.mock("./excel-sheet-reader.js", () => ({
  readWorkbook: mockReadWorkbook,
  requireSheetData: vi.fn((workbook: Array<{ sheet: string; data: unknown[] }>, sheetName: string) => {
    const sheet = workbook.find((entry) => entry.sheet === sheetName);
    if (!sheet) throw new Error(`Missing worksheet: ${sheetName}`);
    return sheet.data;
  }),
  sheetDataToObjects: vi.fn((sheetData: unknown[][]) => {
    const [headers = [], ...rows] = sheetData;
    return rows.map((row) =>
      headers.reduce<Record<string, unknown>>((record, header, index) => {
        if (typeof header === "string" && header.length > 0) {
          record[header] = row[index] ?? null;
        }
        return record;
      }, {})
    );
  }),
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

  mockReadWorkbook.mockResolvedValue([
    {
      sheet: "IT4IT Functional Criteria",
      data: [
        ["Level 1: Capability Group", "Level 2: Function", "Level 3: Functional Component", "Functional Criteria", "Reference Section"],
        ["Strategy to Portfolio", "Strategy Function", "Policy", "Shall align and map to Enterprise Architecture", "6.1.1"],
      ],
    },
    {
      sheet: "Value Stream Activities",
      data: [
        ["Value Stream", "Value Stream Stage", "Activity Criteria", "Reference Section"],
        ["Evaluate", "Gather Influencers Stage", "Shall define Strategic Themes and Strategic Objectives", "5.1.2"],
      ],
    },
    {
      sheet: "FC Participation Matrix",
      data: [
        ["Value Stream", "Value Stream Stage", "Ref", "Policy"],
        ["Evaluate", "Gather Influencers Stage", "5.1.2", "●"],
      ],
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
