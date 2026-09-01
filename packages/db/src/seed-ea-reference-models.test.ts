import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const MINIMAL_BIAN_JSON = JSON.stringify({
  standard: "BIAN Service Landscape",
  version: "14.0.0",
  view: "Value Chain View (canonical)",
  businessAreas: [
    {
      name: "Business Management",
      businessDomains: [
        {
          name: "Business Direction",
          serviceDomains: [
            { name: "Corporate Strategy", semanticApi: false },
            { name: "Asset And Liability Management", description: "ALM", semanticApi: true },
          ],
        },
      ],
    },
    {
      name: "Sales and Service",
      businessDomains: [
        {
          name: "Customer Offer",
          serviceDomains: [
            { name: "Product Directory", semanticApi: true },
          ],
        },
      ],
    },
  ],
});

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    readFileSync: vi.fn((path: unknown, enc?: unknown) => {
      if (typeof path === "string" && path.includes("bian-v14-service-landscape.json")) {
        return MINIMAL_BIAN_JSON;
      }
      return (actual.readFileSync as (p: unknown, e?: unknown) => unknown)(path, enc);
    }),
  };
});

const { mockReadWorkbook } = vi.hoisted(() => ({
  mockReadWorkbook: vi.fn(),
}));

vi.mock("./client.js", () => ({
  prisma: {
    portfolio: { findMany: vi.fn() },
    eaAssessmentScope: { upsert: vi.fn() },
    eaReferenceModel: { upsert: vi.fn() },
    eaReferenceModelArtifact: { upsert: vi.fn() },
    eaReferenceModelElement: { upsert: vi.fn(), count: vi.fn() },
    // BI-DDB48B04 follow-on: the seed now resolves the install's archetype to
    // decide whether an industry-specific reference model applies. A mock that
    // omits these throws "Cannot read properties of undefined" from inside the
    // seed, which reads as a seed bug rather than a stale fixture.
    storefrontConfig: { findFirst: vi.fn() },
    storefrontArchetype: { findUnique: vi.fn() },
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
  eaReferenceModelElement: { upsert: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
  storefrontConfig: { findFirst: ReturnType<typeof vi.fn> };
  storefrontArchetype: { findUnique: ReturnType<typeof vi.fn> };
};

/** Declare the install's setup-chosen archetype for a test. */
function givenInstallArchetype(archetype: { archetypeId: string; category: string } | null): void {
  mockPrisma.storefrontConfig.findFirst.mockResolvedValue(
    archetype ? { archetypeId: "storefront-config-cuid" } : null,
  );
  mockPrisma.storefrontArchetype.findUnique.mockResolvedValue(archetype);
}

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
  // Row-count assertion in seedEaReferenceModels (BI-98D19DF2) requires both
  // models to report a nonzero element count; default to a healthy count so
  // existing tests don't need to know about the assertion unless they're
  // specifically exercising it.
  mockPrisma.eaReferenceModelElement.count.mockResolvedValue(1);
  // These cases assert the BIAN hierarchy IS imported, so they describe a
  // banking install. Non-banking scoping is covered in
  // ea-reference-model-applicability.test.ts and by the case at the end here.
  givenInstallArchetype({ archetypeId: "community-bank", category: "banking-financial-services" });

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

  it("seeds the BIAN Service Landscape reference model", async () => {
    await seedEaReferenceModels();

    expect(mockPrisma.eaReferenceModel.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { slug: "bian_service_landscape_v14_0_0" },
        create: expect.objectContaining({
          name: "BIAN Service Landscape",
          version: "14.0.0",
          authorityType: "standard",
          primaryIndustry: "banking-financial-services",
        }),
      })
    );
  });

  it("seeds BIAN Business Areas, Business Domains, and Service Domains from the JSON", async () => {
    await seedEaReferenceModels();

    const elementCalls = mockPrisma.eaReferenceModelElement.upsert.mock.calls as Array<[{ create: { kind: string; name: string; properties?: Record<string, unknown> } }]>;

    const kinds = elementCalls.map(([args]) => args.create.kind);
    expect(kinds).toContain("business_area");
    expect(kinds).toContain("business_domain");
    expect(kinds).toContain("service_domain");

    const sdCalls = elementCalls.filter(([args]) => args.create.kind === "service_domain");
    const sdWithApi = sdCalls.find(([args]) => args.create.name === "Asset And Liability Management");
    expect(sdWithApi?.[0].create.properties).toEqual(expect.objectContaining({ semanticApi: true }));

    const sdWithoutApi = sdCalls.find(([args]) => args.create.name === "Corporate Strategy");
    expect(sdWithoutApi?.[0].create.properties).toEqual(expect.objectContaining({ semanticApi: false }));
  });

  it("stamps dpfCapabilityKey on BIAN SDs that are in the DPF banking capability map", async () => {
    // The minimal BIAN fixture has: Corporate Strategy, Asset And Liability Management,
    // Product Directory — none of which are in the DPF banking capability map, so no
    // dpfCapabilityKey should be stamped on any element.
    await seedEaReferenceModels();

    const elementCalls = mockPrisma.eaReferenceModelElement.upsert.mock.calls as Array<[{ create: { kind: string; name: string; properties?: Record<string, unknown> } }]>;
    const sdCalls = elementCalls.filter(([args]) => args.create.kind === "service_domain");

    for (const [args] of sdCalls) {
      expect(args.create.properties).not.toHaveProperty("dpfCapabilityKey");
    }
  });

  it("throws when the IT4IT workbook read produces zero elements (BI-98D19DF2)", async () => {
    mockPrisma.eaReferenceModelElement.count.mockResolvedValue(0);

    await expect(seedEaReferenceModels()).rejects.toThrow(/IT4IT reference model imported zero elements/);
  });

  it("throws when the BIAN JSON import produces zero elements (BI-98D19DF2)", async () => {
    // Both models resolve to the same mocked id ("model-1") in this fixture,
    // so distinguish by call order: first count() is IT4IT, second is BIAN.
    let call = 0;
    mockPrisma.eaReferenceModelElement.count.mockImplementation(async () => {
      call += 1;
      return call === 1 ? 1 : 0;
    });

    await expect(seedEaReferenceModels()).rejects.toThrow(/BIAN Service Landscape reference model imported zero elements/);
  });

  it("keeps the routing audit checkout wired to fetch LFS-backed seed workbooks", () => {
    const workflow = readFileSync(
      join(__dirname, "..", "..", "..", ".github", "workflows", "audit-routing-invariants.yml"),
      "utf8"
    );

    // Version-agnostic on purpose: this guard protects `lfs: true` (so CI fetches
    // the LFS-backed seed workbooks), NOT a specific checkout version. Pinning @v6
    // made every legitimate Dependabot actions/checkout bump fail this required
    // test (e.g. #2169 v6→v7); matching only @v\d+ then still broke on exact-version
    // tags like @v7.0.0 (#2251). Match any tag version (major or exact) so bumps
    // stay green while the LFS wiring stays enforced.
    expect(workflow).toMatch(/uses:\s*actions\/checkout@v[\d.]+\s*\n\s*with:\s*\n(?:\s*#.*\n)*\s*lfs:\s*true/);
  });
});

// BI-DDB48B04 follow-on — the reported defect, end to end through the seed.
//
// The eaReferenceModels step imported the BIAN Service Landscape and then
// asserted a non-zero element count for it on EVERY install. seed.ts `step()`
// catches and logs rather than aborting, so on a software-platform install the
// step threw and failed silently on every boot and every upgrade — the same
// "reports success while importing nothing" shape the assertion exists to
// prevent, inverted into an assertion asserting the wrong thing.
describe("industry scoping of reference models", () => {
  // The shared fixture resolves BOTH models to the id "model-1", which makes
  // any per-model assertion vacuous (a scoping bug still passes). These cases
  // are specifically about which model got what, so they need distinct ids.
  const IT4IT_ID = "it4it-model";
  const BIAN_ID = "bian-model";

  function givenDistinctModelIds(): void {
    mockPrisma.eaReferenceModel.upsert.mockImplementation(
      async (args: { where: { slug: string } }) => ({
        id: args.where.slug.startsWith("bian") ? BIAN_ID : IT4IT_ID,
      }),
    );
    // IT4IT imported rows; BIAN has none because it was never imported.
    mockPrisma.eaReferenceModelElement.count.mockImplementation(
      async (args: { where: { modelId: string } }) => (args.where.modelId === IT4IT_ID ? 1 : 0),
    );
  }

  /** Element rows written against the BIAN model id. */
  function bianElementUpserts(): unknown[] {
    return mockPrisma.eaReferenceModelElement.upsert.mock.calls.filter((call: unknown[]) => {
      const args = call[0] as { where: { modelId_slug: { modelId: string } } };
      return args.where.modelId_slug.modelId === BIAN_ID;
    });
  }

  it("does not import or assert BIAN on a software-platform install", async () => {
    givenInstallArchetype({ archetypeId: "software-platform", category: "software-platform" });
    givenDistinctModelIds();

    // Under the old unconditional assertion, a zero BIAN count threw here.
    await expect(seedEaReferenceModels()).resolves.not.toThrow();
    expect(bianElementUpserts()).toHaveLength(0);
  });

  it("imports BIAN on a banking install", async () => {
    givenInstallArchetype({ archetypeId: "community-bank", category: "banking-financial-services" });
    mockPrisma.eaReferenceModel.upsert.mockImplementation(
      async (args: { where: { slug: string } }) => ({
        id: args.where.slug.startsWith("bian") ? BIAN_ID : IT4IT_ID,
      }),
    );
    mockPrisma.eaReferenceModelElement.count.mockResolvedValue(1);

    await seedEaReferenceModels();
    expect(bianElementUpserts().length).toBeGreaterThan(0);
  });

  it("still catches a genuinely empty BIAN import on a banking install", async () => {
    givenInstallArchetype({ archetypeId: "community-bank", category: "banking-financial-services" });
    mockPrisma.eaReferenceModel.upsert.mockImplementation(
      async (args: { where: { slug: string } }) => ({
        id: args.where.slug.startsWith("bian") ? BIAN_ID : IT4IT_ID,
      }),
    );
    // IT4IT fine, BIAN empty — the case the assertion exists for must still fire.
    mockPrisma.eaReferenceModelElement.count.mockImplementation(
      async (args: { where: { modelId: string } }) => (args.where.modelId === IT4IT_ID ? 1 : 0),
    );

    await expect(seedEaReferenceModels()).rejects.toThrow(/BIAN Service Landscape reference model imported zero/);
  });

  // The catalogue row is always upserted, so a non-banking install can still
  // see that BIAN exists and what industry it serves — matching how
  // seed-banking-compliance.ts seeds banking regulations everywhere and scopes
  // them at consumption. Only the element payload is gated.
  it("still records the BIAN catalogue entry on a non-banking install", async () => {
    givenInstallArchetype({ archetypeId: "software-platform", category: "software-platform" });
    givenDistinctModelIds();

    await seedEaReferenceModels();

    const seededBianCatalogue = mockPrisma.eaReferenceModel.upsert.mock.calls.some((call: unknown[]) => {
      const args = call[0] as { create?: { primaryIndustry?: string } };
      return args.create?.primaryIndustry === "banking-financial-services";
    });
    expect(seededBianCatalogue).toBe(true);
  });
});
