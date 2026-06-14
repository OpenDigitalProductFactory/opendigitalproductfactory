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
import { seedEaSysmlAiCockpit } from "./seed-ea-sysml-ai-cockpit.js";

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

const TOTAL_ELEMENTS = 30; // 1 pkg + 9 req + 1 constraint + 9 parts + 4 interfaces + 6 verification

beforeEach(() => {
  vi.clearAllMocks();
  m.eaNotation.findUnique.mockResolvedValue({ id: "n-sysml2" });
  m.eaElementType.findUniqueOrThrow.mockImplementation(async (a: { where: { notationId_slug: { slug: string } } }) => ({ id: `et-${a.where.notationId_slug.slug}` }));
  m.eaRelationshipType.findUniqueOrThrow.mockImplementation(async (a: { where: { notationId_slug: { slug: string } } }) => ({ id: `rt-${a.where.notationId_slug.slug}` }));
  // Element id is derived from infraCiKey so relationship endpoints are assertable.
  m.eaElement.create.mockImplementation(async (a: { data: { infraCiKey: string } }) => ({ id: `el-${a.data.infraCiKey}` }));
  m.eaElement.update.mockImplementation(async (a: { where: { id: string } }) => ({ id: a.where.id }));
  m.eaRelationship.create.mockResolvedValue({});
  m.viewpointDefinition.findUnique.mockResolvedValue({ id: "vp-1" });
  m.eaView.create.mockResolvedValue({ id: "view-1" });
  m.eaViewElement.upsert.mockResolvedValue({});
});

describe("seedEaSysmlAiCockpit", () => {
  it("creates the full model on first run (findFirst returns null)", async () => {
    m.eaElement.findFirst.mockResolvedValue(null);
    m.eaRelationship.findFirst.mockResolvedValue(null);
    m.eaView.findFirst.mockResolvedValue(null);

    await seedEaSysmlAiCockpit();

    expect(m.eaElement.create).toHaveBeenCalledTimes(TOTAL_ELEMENTS);
    expect(m.eaElement.update).not.toHaveBeenCalled();
    // The email-triage requirement is present.
    const createdKeys = m.eaElement.create.mock.calls.map(([a]) => (a as { data: { infraCiKey: string } }).data.infraCiKey);
    expect(createdKeys).toContain("sysml:aic:req:REQ-AIC-5");
    // Routing Policy Engine satisfies REQ-AIC-1.
    expect(m.eaRelationship.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fromElementId: "el-sysml:aic:part:router",
          toElementId: "el-sysml:aic:req:REQ-AIC-1",
          relationshipTypeId: "rt-satisfies",
        }),
      })
    );
    // VC-AIC-E1 verifies REQ-AIC-5.
    expect(m.eaRelationship.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fromElementId: "el-sysml:aic:vc:VC-AIC-E1",
          toElementId: "el-sysml:aic:req:REQ-AIC-5",
          relationshipTypeId: "rt-verifies",
        }),
      })
    );
    expect(m.eaView.create).toHaveBeenCalledTimes(1);
    expect(m.eaViewElement.upsert).toHaveBeenCalledTimes(TOTAL_ELEMENTS);
  });

  it("is idempotent on re-run: updates existing elements, creates no duplicate rels or view", async () => {
    m.eaElement.findFirst.mockResolvedValue({ id: "existing-el" });
    m.eaRelationship.findFirst.mockResolvedValue({ id: "existing-rel" });
    m.eaView.findFirst.mockResolvedValue({ id: "existing-view" });

    await seedEaSysmlAiCockpit();

    expect(m.eaElement.update).toHaveBeenCalledTimes(TOTAL_ELEMENTS);
    expect(m.eaElement.create).not.toHaveBeenCalled();
    expect(m.eaRelationship.create).not.toHaveBeenCalled();
    expect(m.eaView.create).not.toHaveBeenCalled();
    // View elements still reconciled idempotently.
    expect(m.eaViewElement.upsert).toHaveBeenCalledTimes(TOTAL_ELEMENTS);
  });

  it("skips cleanly when the sysml2 notation is not seeded", async () => {
    m.eaNotation.findUnique.mockResolvedValue(null);
    await seedEaSysmlAiCockpit();
    expect(m.eaElement.create).not.toHaveBeenCalled();
    expect(m.eaElement.update).not.toHaveBeenCalled();
  });
});
