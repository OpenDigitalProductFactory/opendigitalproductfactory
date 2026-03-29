import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    eaNotation:         { findUnique: vi.fn() },
    eaElementType:      { findUnique: vi.fn(), findMany: vi.fn() },
    eaRelationshipType: { findUnique: vi.fn() },
    eaRelationshipRule: { findFirst: vi.fn() },
    eaElement:          { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    eaRelationship:     { create: vi.fn(), findMany: vi.fn() },
  },
}));

import { prisma } from "@dpf/db";
import { executeTool } from "./mcp-tools";

describe("create_ea_element", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns error when element type slug not found", async () => {
    vi.mocked(prisma.eaNotation.findUnique).mockResolvedValue({ id: "n-1" } as never);
    vi.mocked(prisma.eaElementType.findUnique).mockResolvedValue(null);
    const result = await executeTool("create_ea_element", { name: "X", elementTypeSlug: "nonexistent" }, "u-1");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/element type/i);
  });

  it("creates element with conceptual default and returns elementId", async () => {
    vi.mocked(prisma.eaNotation.findUnique).mockResolvedValue({ id: "n-1" } as never);
    vi.mocked(prisma.eaElementType.findUnique).mockResolvedValue({ id: "et-1", slug: "digital_product", name: "Digital Product" } as never);
    vi.mocked(prisma.eaElement.create).mockResolvedValue({ id: "el-1", refinementLevel: "conceptual" } as never);
    const result = await executeTool("create_ea_element", { name: "Customer Portal", elementTypeSlug: "digital_product" }, "u-1");
    expect(result.success).toBe(true);
    expect(result.entityId).toBe("el-1");
    expect(prisma.eaElement.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ refinementLevel: "conceptual" }),
    }));
  });
});

describe("create_ea_relationship", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("blocks relationship not permitted by EaRelationshipRule", async () => {
    vi.mocked(prisma.eaNotation.findUnique).mockResolvedValue({ id: "n-1" } as never);
    vi.mocked(prisma.eaRelationshipType.findUnique).mockResolvedValue({ id: "rt-1" } as never);
    vi.mocked(prisma.eaElement.findUnique)
      .mockResolvedValueOnce({ elementTypeId: "et-from", name: "From" } as never)
      .mockResolvedValueOnce({ elementTypeId: "et-to", name: "To" } as never);
    vi.mocked(prisma.eaRelationshipRule.findFirst).mockResolvedValue(null);
    const result = await executeTool("create_ea_relationship", { fromElementId: "e-1", toElementId: "e-2", relationshipTypeSlug: "realizes" }, "u-1");
    expect(result.success).toBe(false);
    expect(result.data?.validationResult).toBe("blocked");
  });
});

describe("classify_ea_element", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("updates refinementLevel and itValueStream", async () => {
    vi.mocked(prisma.eaElement.update).mockResolvedValue({ id: "el-1", refinementLevel: "actual", itValueStream: "operate" } as never);
    const result = await executeTool("classify_ea_element", { elementId: "el-1", itValueStream: "operate", refinementLevel: "actual" }, "u-1");
    expect(result.success).toBe(true);
    expect(prisma.eaElement.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "el-1" },
      data: expect.objectContaining({ itValueStream: "operate", refinementLevel: "actual" }),
    }));
  });

  it("returns error when no classification fields provided", async () => {
    const result = await executeTool("classify_ea_element", { elementId: "el-1" }, "u-1");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/nothing to update/i);
  });
});

describe("query_ontology_graph", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns elements filtered by elementTypeSlugs", async () => {
    vi.mocked(prisma.eaNotation.findUnique).mockResolvedValue({ id: "n-1" } as never);
    vi.mocked(prisma.eaElementType.findMany).mockResolvedValue([{ id: "et-1" }] as never);
    vi.mocked(prisma.eaElement.findMany).mockResolvedValue([
      { id: "el-1", name: "Portal", elementType: { slug: "digital_product", name: "Digital Product" }, refinementLevel: "conceptual", itValueStream: null, ontologyRole: null },
    ] as never);
    vi.mocked(prisma.eaElement.count).mockResolvedValue(1);
    const result = await executeTool("query_ontology_graph", { elementTypeSlugs: ["digital_product"], limit: 5 }, "u-1");
    expect(result.success).toBe(true);
    expect(result.data?.elements).toHaveLength(1);
  });
});
