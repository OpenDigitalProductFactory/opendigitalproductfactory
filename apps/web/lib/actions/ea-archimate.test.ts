import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    eaNotation: { findUnique: vi.fn() },
    eaElementType: { findMany: vi.fn() },
    eaElement: { create: vi.fn(), findMany: vi.fn() },
    eaRelationship: { create: vi.fn(), findMany: vi.fn() },
    eaRelationshipType: { findMany: vi.fn() },
    eaRelationshipRule: { findFirst: vi.fn() },
    eaConformanceIssue: { create: vi.fn() },
  },
}));

vi.mock("@/lib/ea/archimate-xml", () => ({
  parseArchimateXml: vi.fn().mockReturnValue({
    modelName: "Test",
    elements: [{ archimateId: "a-1", name: "Actor", slug: "business_actor", folder: "Business" }],
    relationships: [],
  }),
  generateArchimateXml: vi.fn().mockReturnValue("<?xml?>"),
}));

import { prisma } from "@dpf/db";
import { importArchimateFile, exportArchimateFile } from "./ea-archimate";

describe("importArchimateFile", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns error when archimate4 notation not found", async () => {
    vi.mocked(prisma.eaNotation.findUnique).mockResolvedValue(null);
    const result = await importArchimateFile({ fileContentBase64: "x", fileName: "test.archimate", userId: "u-1" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/notation/i);
  });

  it("returns error when file exceeds 1MB", async () => {
    const bigContent = "x".repeat(1_500_000);
    const result = await importArchimateFile({ fileContentBase64: bigContent, fileName: "big.archimate", userId: "u-1" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/1MB/i);
  });

  it("creates elements and returns counts on success", async () => {
    vi.mocked(prisma.eaNotation.findUnique).mockResolvedValue({ id: "n-1" } as never);
    vi.mocked(prisma.eaElementType.findMany).mockResolvedValue([{ id: "et-1", slug: "business_actor" }] as never);
    vi.mocked(prisma.eaElement.create).mockResolvedValue({ id: "el-1" } as never);
    vi.mocked(prisma.eaRelationshipType.findMany).mockResolvedValue([]);

    const result = await importArchimateFile({ fileContentBase64: Buffer.from("<xml/>").toString("base64"), fileName: "test.archimate", userId: "u-1" });
    expect(result.ok).toBe(true);
    expect(result.data?.elementsCreated).toBe(1);
    expect(result.data?.relationshipsCreated).toBe(0);
    expect(prisma.eaElement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lifecycleStatus: "draft",
          refinementLevel: "conceptual",
          properties: expect.objectContaining({ archimateId: "a-1" }),
        }),
      })
    );
  });

  it("creates conformance issue for unknown element type", async () => {
    const { parseArchimateXml } = await import("@/lib/ea/archimate-xml");
    vi.mocked(parseArchimateXml).mockReturnValueOnce({
      modelName: "Test",
      elements: [{ archimateId: "u-1", name: "Unknown", slug: "object", folder: "Business", unknownArchimateType: "archimate:FutureThing" }],
      relationships: [],
    });
    vi.mocked(prisma.eaNotation.findUnique).mockResolvedValue({ id: "n-1" } as never);
    vi.mocked(prisma.eaElementType.findMany).mockResolvedValue([{ id: "et-obj", slug: "object" }] as never);
    vi.mocked(prisma.eaElement.create).mockResolvedValue({ id: "el-1" } as never);
    vi.mocked(prisma.eaConformanceIssue.create).mockResolvedValue({
      id: "ci-1", issueType: "unknown_archimate_type", severity: "warn", message: 'Unrecognised ArchiMate type "archimate:FutureThing". Imported as "object" (common domain).',
    } as never);
    vi.mocked(prisma.eaRelationshipType.findMany).mockResolvedValue([]);

    await importArchimateFile({ fileContentBase64: Buffer.from("<xml/>").toString("base64"), fileName: "test.archimate", userId: "u-1" });
    expect(prisma.eaConformanceIssue.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ issueType: "unknown_archimate_type", severity: "warn" }),
      })
    );
  });
});

describe("exportArchimateFile", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns error for unknown scopeType", async () => {
    const result = await exportArchimateFile({ scopeType: "invalid" as never, scopeRef: "x", userId: "u-1" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/scopeType/i);
  });

  it("queries elements by portfolioId for portfolio scope", async () => {
    vi.mocked(prisma.eaElement.findMany).mockResolvedValue([]);
    vi.mocked(prisma.eaRelationship.findMany).mockResolvedValue([]);
    const result = await exportArchimateFile({ scopeType: "portfolio", scopeRef: "port-1", userId: "u-1" });
    expect(result.ok).toBe(true);
    expect(prisma.eaElement.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ portfolioId: "port-1" }),
    }));
  });

  it("returns base64 encoded XML on success", async () => {
    vi.mocked(prisma.eaElement.findMany).mockResolvedValue([]);
    vi.mocked(prisma.eaRelationship.findMany).mockResolvedValue([]);
    const result = await exportArchimateFile({ scopeType: "digital_product", scopeRef: "dp-1", userId: "u-1" });
    expect(result.ok).toBe(true);
    expect(result.data?.fileContentBase64).toBeDefined();
    expect(result.data?.elementCount).toBe(0);
  });
});
