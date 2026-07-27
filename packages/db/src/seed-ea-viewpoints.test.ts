import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./client.js", () => ({
  prisma: {
    eaNotation: { findUnique: vi.fn() },
    eaElementType: { findUniqueOrThrow: vi.fn() },
    eaRelationshipType: { findUniqueOrThrow: vi.fn() },
    viewpointDefinition: { upsert: vi.fn() },
  },
}));

import { prisma } from "./client.js";
import {
  ARCHIMATE_VIEWPOINTS,
  seedViewpointsForNotation,
  SYSML_VIEWPOINTS,
  type ViewpointSpec,
} from "./seed-ea-viewpoints.js";

const mockPrisma = prisma as unknown as {
  eaNotation: { findUnique: ReturnType<typeof vi.fn> };
  eaElementType: { findUniqueOrThrow: ReturnType<typeof vi.fn> };
  eaRelationshipType: { findUniqueOrThrow: ReturnType<typeof vi.fn> };
  viewpointDefinition: { upsert: ReturnType<typeof vi.fn> };
};

const SAMPLE: ViewpointSpec[] = [
  { name: "Test Viewpoint", description: "d", elementSlugs: ["requirement"], relSlugs: ["satisfies"] },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.eaElementType.findUniqueOrThrow.mockResolvedValue({ id: "et-1" });
  mockPrisma.eaRelationshipType.findUniqueOrThrow.mockResolvedValue({ id: "rt-1" });
  mockPrisma.viewpointDefinition.upsert.mockResolvedValue({});
});

describe("seedViewpointsForNotation", () => {
  it("resolves slugs and upserts viewpoints when the notation exists", async () => {
    mockPrisma.eaNotation.findUnique.mockResolvedValue({ id: "n-1" });
    const count = await seedViewpointsForNotation("sysml2", SAMPLE);
    expect(count).toBe(1);
    expect(mockPrisma.eaElementType.findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ where: { notationId_slug: { notationId: "n-1", slug: "requirement" } } })
    );
    expect(mockPrisma.viewpointDefinition.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: "Test Viewpoint" } })
    );
  });

  it("skips silently when an optional notation has not been seeded", async () => {
    mockPrisma.eaNotation.findUnique.mockResolvedValue(null);
    const count = await seedViewpointsForNotation("sysml2", SAMPLE, { optional: true });
    expect(count).toBe(0);
    expect(mockPrisma.viewpointDefinition.upsert).not.toHaveBeenCalled();
  });

  it("throws when a required notation is missing (seed-ordering bug)", async () => {
    mockPrisma.eaNotation.findUnique.mockResolvedValue(null);
    await expect(seedViewpointsForNotation("archimate4", SAMPLE)).rejects.toThrow(/required notation/);
  });
});

describe("SYSML_VIEWPOINTS", () => {
  it("defines the requirements/verification and decomposition/interfaces viewpoints", () => {
    const names = SYSML_VIEWPOINTS.map((v) => v.name);
    expect(names).toContain("Systems Requirements & Verification");
    expect(names).toContain("System Decomposition & Interfaces");
  });

  it("only references slugs that exist in the sysml2 notation seed", () => {
    // Guards against viewpoint drift: every slug here must be a seeded sysml2 type.
    const elementSlugs = new Set([
      "package", "part_definition", "part_usage", "interface_definition", "port",
      "requirement", "constraint", "action", "state", "verification_case", "analysis_case",
    ]);
    const relSlugs = new Set(["contains", "specializes", "connects", "allocates", "satisfies", "verifies", "refines", "traces", "redirects_to"]);
    for (const vp of SYSML_VIEWPOINTS) {
      for (const s of vp.elementSlugs) expect(elementSlugs).toContain(s);
      for (const s of vp.relSlugs) expect(relSlugs).toContain(s);
    }
  });
});

describe("ARCHIMATE_VIEWPOINTS", () => {
  it("defines the mixed business/application realization view used by AI routing", () => {
    const routing = ARCHIMATE_VIEWPOINTS.find((viewpoint) => viewpoint.name === "AI Routing Realization");
    expect(routing?.elementSlugs).toEqual(
      expect.arrayContaining([
        "business_capability",
        "business_process",
        "application_component",
        "event_evidence",
      ]),
    );
    expect(routing?.relSlugs).toContain("realizes");
  });
});
