import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./client.js", () => ({
  prisma: {
    eaNotation: { findUnique: vi.fn() },
    eaElementType: { findUniqueOrThrow: vi.fn() },
    eaRelationshipType: { findUniqueOrThrow: vi.fn() },
    eaElement: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    eaRelationship: { findFirst: vi.fn(), create: vi.fn() },
    eaConformanceIssue: { findFirst: vi.fn(), create: vi.fn() },
    viewpointDefinition: { findUnique: vi.fn() },
    eaView: { findFirst: vi.fn(), create: vi.fn() },
    eaViewElement: { upsert: vi.fn() },
  },
}));

import { prisma } from "./client.js";
import { seedEaSysmlDataAuthority } from "./seed-ea-sysml-data-authority.js";

const m = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

const TOTAL_ELEMENTS = 22; // 1 pkg + 9 parts + 6 requirements + 1 constraint + 5 verification

beforeEach(() => {
  vi.clearAllMocks();
  m.eaNotation.findUnique.mockResolvedValue({ id: "n-sysml2" });
  m.eaElementType.findUniqueOrThrow.mockImplementation(async (a: { where: { notationId_slug: { slug: string } } }) => ({ id: `et-${a.where.notationId_slug.slug}` }));
  m.eaRelationshipType.findUniqueOrThrow.mockImplementation(async (a: { where: { notationId_slug: { slug: string } } }) => ({ id: `rt-${a.where.notationId_slug.slug}` }));
  m.eaElement.create.mockImplementation(async (a: { data: { infraCiKey: string } }) => ({ id: `el-${a.data.infraCiKey}` }));
  m.eaElement.update.mockImplementation(async (a: { where: { id: string } }) => ({ id: a.where.id }));
  m.eaRelationship.create.mockResolvedValue({});
  m.eaConformanceIssue.create.mockResolvedValue({});
  m.viewpointDefinition.findUnique.mockResolvedValue({ id: "vp-1" });
  m.eaView.create.mockResolvedValue({ id: "view-1" });
  m.eaViewElement.upsert.mockResolvedValue({});
});

describe("seedEaSysmlDataAuthority", () => {
  it("creates the full data-authority model on first run", async () => {
    m.eaElement.findFirst.mockResolvedValue(null);
    m.eaRelationship.findFirst.mockResolvedValue(null);
    m.eaConformanceIssue.findFirst.mockResolvedValue(null);
    m.eaView.findFirst.mockResolvedValue(null);

    await seedEaSysmlDataAuthority();

    expect(m.eaElement.create).toHaveBeenCalledTimes(TOTAL_ELEMENTS);
    // The mirror satisfies the no-silent-overwrite invariant.
    expect(m.eaRelationship.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fromElementId: "el-sysml:data:part:mirror",
          toElementId: "el-sysml:data:req:REQ-DATA-2",
          relationshipTypeId: "rt-satisfies",
        }),
      })
    );
    // One-way authority→projection topology edge (Postgres connects Neo4j).
    expect(m.eaRelationship.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fromElementId: "el-sysml:data:part:postgres",
          toElementId: "el-sysml:data:part:neo4j",
          relationshipTypeId: "rt-connects",
        }),
      })
    );
    // The vestigial-syncedAt drift is filed as a conformance issue.
    expect(m.eaConformanceIssue.create).toHaveBeenCalledTimes(1);
    expect(m.eaConformanceIssue.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ issueType: "projection-freshness-signal-split" }) })
    );
    expect(m.eaView.create).toHaveBeenCalledTimes(1);
    expect(m.eaViewElement.upsert).toHaveBeenCalledTimes(TOTAL_ELEMENTS);
  });

  it("is idempotent on re-run: updates elements, no duplicate rels/view/conformance issue", async () => {
    m.eaElement.findFirst.mockResolvedValue({ id: "existing-el" });
    m.eaRelationship.findFirst.mockResolvedValue({
      id: "existing-rel",
      notationSlug: "sysml2",
      properties: {},
    });
    m.eaConformanceIssue.findFirst.mockResolvedValue({ id: "existing-issue" });
    m.eaView.findFirst.mockResolvedValue({
      id: "existing-view",
      description:
        "Current-state data-authority model: the authority, its three derived projections, the invariants they satisfy, and the records that verify them.",
      viewpointId: "vp-1",
      scopeRef: "data-authority",
    });

    await seedEaSysmlDataAuthority();

    expect(m.eaElement.update).toHaveBeenCalledTimes(TOTAL_ELEMENTS);
    expect(m.eaElement.create).not.toHaveBeenCalled();
    expect(m.eaRelationship.create).not.toHaveBeenCalled();
    expect(m.eaConformanceIssue.create).not.toHaveBeenCalled();
    expect(m.eaView.create).not.toHaveBeenCalled();
  });

  it("skips cleanly when the sysml2 notation is not seeded", async () => {
    m.eaNotation.findUnique.mockResolvedValue(null);
    await seedEaSysmlDataAuthority();
    expect(m.eaElement.create).not.toHaveBeenCalled();
    expect(m.eaElement.update).not.toHaveBeenCalled();
  });
});
