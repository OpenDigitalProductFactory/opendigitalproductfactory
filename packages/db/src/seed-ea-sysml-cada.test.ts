import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./client.js", () => ({
  prisma: {
    eaNotation: { findUnique: vi.fn() },
    eaElementType: { findUniqueOrThrow: vi.fn() },
    eaRelationshipType: { findUniqueOrThrow: vi.fn() },
    eaElement: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    eaRelationship: { findFirst: vi.fn(), create: vi.fn() },
    viewpointDefinition: { findUnique: vi.fn() },
    eaView: { findFirst: vi.fn(), create: vi.fn() },
    eaViewElement: { upsert: vi.fn() },
  },
}));

import { prisma } from "./client.js";
import { seedEaSysmlCada } from "./seed-ea-sysml-cada.js";

const m = prisma as unknown as {
  eaNotation: { findUnique: ReturnType<typeof vi.fn> };
  eaElementType: { findUniqueOrThrow: ReturnType<typeof vi.fn> };
  eaRelationshipType: { findUniqueOrThrow: ReturnType<typeof vi.fn> };
  eaElement: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  eaRelationship: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  viewpointDefinition: { findUnique: ReturnType<typeof vi.fn> };
  eaView: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  eaViewElement: { upsert: ReturnType<typeof vi.fn> };
};

const TOTAL_ELEMENTS = 24; // 1 pkg + 8 req + 1 constraint + 8 parts + 6 verification

beforeEach(() => {
  vi.clearAllMocks();
  m.eaNotation.findUnique.mockResolvedValue({ id: "n-sysml2" });
  m.eaElementType.findUniqueOrThrow.mockImplementation(async (a: { where: { notationId_slug: { slug: string } } }) => ({ id: `et-${a.where.notationId_slug.slug}` }));
  m.eaRelationshipType.findUniqueOrThrow.mockImplementation(async (a: { where: { notationId_slug: { slug: string } } }) => ({ id: `rt-${a.where.notationId_slug.slug}` }));
  m.eaElement.create.mockImplementation(async (a: { data: { infraCiKey: string } }) => ({ id: `el-${a.data.infraCiKey}` }));
  m.eaElement.update.mockImplementation(async (a: { where: { id: string } }) => ({ id: a.where.id }));
  m.eaRelationship.create.mockResolvedValue({});
  m.viewpointDefinition.findUnique.mockResolvedValue({ id: "vp-1" });
  m.eaView.create.mockResolvedValue({ id: "view-1" });
  m.eaViewElement.upsert.mockResolvedValue({});
});

describe("seedEaSysmlCada", () => {
  it("creates the CADA requirements, allocations, verification cases, and view", async () => {
    m.eaElement.findFirst.mockResolvedValue(null);
    m.eaRelationship.findFirst.mockResolvedValue(null);
    m.eaView.findFirst.mockResolvedValue(null);

    await seedEaSysmlCada();

    expect(m.eaElement.create).toHaveBeenCalledTimes(TOTAL_ELEMENTS);
    const createdKeys = m.eaElement.create.mock.calls.map(([a]) => (a as { data: { infraCiKey: string } }).data.infraCiKey);
    expect(createdKeys).toContain("sysml:cada:req:REQ-CADA-2");
    expect(createdKeys).toContain("sysml:cada:part:residency");
    expect(createdKeys).toContain("sysml:cada:vc:VC-CADA-LOCAL");

    expect(m.eaRelationship.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fromElementId: "el-sysml:cada:part:residency",
          toElementId: "el-sysml:cada:req:REQ-CADA-2",
          relationshipTypeId: "rt-satisfies",
        }),
      }),
    );
    expect(m.eaRelationship.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fromElementId: "el-sysml:cada:vc:VC-CADA-LOCAL",
          toElementId: "el-sysml:cada:req:REQ-CADA-2",
          relationshipTypeId: "rt-verifies",
        }),
      }),
    );
    expect(m.eaView.create).toHaveBeenCalledTimes(1);
    expect(m.eaViewElement.upsert).toHaveBeenCalledTimes(TOTAL_ELEMENTS);
  });

  it("is idempotent on re-run", async () => {
    m.eaElement.findFirst.mockResolvedValue({ id: "existing-el" });
    m.eaRelationship.findFirst.mockResolvedValue({ id: "existing-rel" });
    m.eaView.findFirst.mockResolvedValue({ id: "existing-view" });

    await seedEaSysmlCada();

    expect(m.eaElement.update).toHaveBeenCalledTimes(TOTAL_ELEMENTS);
    expect(m.eaElement.create).not.toHaveBeenCalled();
    expect(m.eaRelationship.create).not.toHaveBeenCalled();
    expect(m.eaView.create).not.toHaveBeenCalled();
    expect(m.eaViewElement.upsert).toHaveBeenCalledTimes(TOTAL_ELEMENTS);
  });

  it("skips cleanly when the sysml2 notation is not seeded", async () => {
    m.eaNotation.findUnique.mockResolvedValue(null);
    await seedEaSysmlCada();
    expect(m.eaElement.create).not.toHaveBeenCalled();
    expect(m.eaElement.update).not.toHaveBeenCalled();
  });
});
