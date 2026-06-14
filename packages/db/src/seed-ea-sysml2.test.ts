import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the prisma client — these tests assert on the seed's upsert calls, no DB.
vi.mock("./client.js", () => ({
  prisma: {
    eaNotation: { upsert: vi.fn() },
    eaElementType: { upsert: vi.fn() },
    eaRelationshipType: { upsert: vi.fn() },
    eaRelationshipRule: { upsert: vi.fn() },
    eaDqRule: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    eaTraversalPattern: { upsert: vi.fn() },
  },
}));

import { prisma } from "./client.js";
import { seedEaSysml2 } from "./seed-ea-sysml2.js";

type UpsertArgs = { where: Record<string, unknown> };

const mockPrisma = prisma as unknown as {
  eaNotation: { upsert: ReturnType<typeof vi.fn> };
  eaElementType: { upsert: ReturnType<typeof vi.fn> };
  eaRelationshipType: { upsert: ReturnType<typeof vi.fn> };
  eaRelationshipRule: { upsert: ReturnType<typeof vi.fn> };
  eaDqRule: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  eaTraversalPattern: { upsert: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.eaNotation.upsert.mockResolvedValue({ id: "sysml2-notation" });
  // Return a stable id derived from the element/rel slug so the seed's slug→id
  // maps populate and relationship rules can resolve.
  mockPrisma.eaElementType.upsert.mockImplementation(async (args: UpsertArgs) => {
    const slug = (args.where as { notationId_slug: { slug: string } }).notationId_slug.slug;
    return { id: `et-${slug}` };
  });
  mockPrisma.eaRelationshipType.upsert.mockImplementation(async (args: UpsertArgs) => {
    const slug = (args.where as { notationId_slug: { slug: string } }).notationId_slug.slug;
    return { id: `rt-${slug}` };
  });
  mockPrisma.eaRelationshipRule.upsert.mockResolvedValue({});
  mockPrisma.eaDqRule.findFirst.mockResolvedValue(null);
  mockPrisma.eaDqRule.create.mockResolvedValue({});
  mockPrisma.eaDqRule.update.mockResolvedValue({});
  mockPrisma.eaTraversalPattern.upsert.mockResolvedValue({});
});

describe("seedEaSysml2", () => {
  it("upserts the sysml2 notation", async () => {
    await seedEaSysml2();
    expect(mockPrisma.eaNotation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { slug: "sysml2" },
        create: expect.objectContaining({ slug: "sysml2", name: "SysML v2", version: "2.0" }),
      })
    );
  });

  it("seeds the SysML v2 element types including requirement, constraint, and verification_case", async () => {
    await seedEaSysml2();
    const slugs = mockPrisma.eaElementType.upsert.mock.calls.map(
      ([args]) => (args.where as { notationId_slug: { slug: string } }).notationId_slug.slug
    );
    // Phase 1 minimal subset (design spec §10).
    for (const expected of [
      "package", "part_definition", "part_usage", "interface_definition", "port",
      "requirement", "constraint", "action", "state", "verification_case", "analysis_case",
    ]) {
      expect(slugs).toContain(expected);
    }
    expect(slugs).toHaveLength(11);
  });

  it("seeds the satisfy/verify/allocate/trace relationship types", async () => {
    await seedEaSysml2();
    const slugs = mockPrisma.eaRelationshipType.upsert.mock.calls.map(
      ([args]) => (args.where as { notationId_slug: { slug: string } }).notationId_slug.slug
    );
    for (const expected of ["contains", "specializes", "connects", "allocates", "satisfies", "verifies", "refines", "traces"]) {
      expect(slugs).toContain(expected);
    }
  });

  it("seeds a verification_case → requirement verifies rule", async () => {
    await seedEaSysml2();
    expect(mockPrisma.eaRelationshipRule.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          fromElementTypeId_toElementTypeId_relationshipTypeId: {
            fromElementTypeId: "et-verification_case",
            toElementTypeId: "et-requirement",
            relationshipTypeId: "rt-verifies",
          },
        },
      })
    );
  });

  it("creates DQ rules on first run (findFirst returns null)", async () => {
    await seedEaSysml2();
    expect(mockPrisma.eaDqRule.create).toHaveBeenCalledTimes(3);
    expect(mockPrisma.eaDqRule.update).not.toHaveBeenCalled();
  });

  it("is idempotent: a second run updates existing DQ rules instead of creating duplicates", async () => {
    mockPrisma.eaDqRule.findFirst.mockResolvedValue({ id: "existing-dq" });
    await seedEaSysml2();
    expect(mockPrisma.eaDqRule.create).not.toHaveBeenCalled();
    expect(mockPrisma.eaDqRule.update).toHaveBeenCalledTimes(3);
  });

  it("seeds the requirement_satisfaction traversal pattern", async () => {
    await seedEaSysml2();
    expect(mockPrisma.eaTraversalPattern.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { notationId_slug: { notationId: "sysml2-notation", slug: "requirement_satisfaction" } },
      })
    );
  });
});
