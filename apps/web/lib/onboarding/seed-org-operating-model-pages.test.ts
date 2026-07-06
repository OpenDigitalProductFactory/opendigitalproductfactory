import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  seedOrgOperatingModelPages,
  OPERATING_MODEL_SEED_MARKER,
  type SeedOperatingModelPagesClient,
} from "./seed-org-operating-model-pages";

const ORG_ID = "org-1";

type FakeState = {
  orgName: string | null;
  businessContext: { targetMarket: string | null; portfolioDecomposition: unknown } | null;
  portfoliosBySlug: Record<string, { id: string }>;
  productsByPortfolioId: Record<string, Array<{ id: string; productId: string; name: string; description: string | null }>>;
  offeringsByProductId: Record<string, Array<{ name: string }>>;
  existingPages: Record<string, { id: string; body: string }>;
  profile: { profileId: string; currentVersionId: string | null } | null;
};

function makeFakeDb(state: FakeState) {
  const writes = {
    pageCreates: [] as Array<Record<string, unknown>>,
    pageUpdates: [] as Array<Record<string, unknown>>,
    revisions: [] as Array<Record<string, unknown>>,
    materials: [] as Array<Record<string, unknown>>,
  };
  let nextId = 100;

  const db: SeedOperatingModelPagesClient = {
    organization: {
      findUnique: async () => (state.orgName === null ? null : { name: state.orgName }),
    },
    businessContext: {
      findUnique: async () => state.businessContext,
    },
    portfolio: {
      findUnique: async (args: unknown) => {
        const slug = (args as { where: { slug: string } }).where.slug;
        return state.portfoliosBySlug[slug] ?? null;
      },
    },
    digitalProduct: {
      findMany: async (args: unknown) => {
        const portfolioId = (args as { where: { portfolioId: string } }).where.portfolioId;
        return state.productsByPortfolioId[portfolioId] ?? [];
      },
    },
    serviceOffering: {
      findMany: async (args: unknown) => {
        const productId = (args as { where: { digitalProductId: string } }).where.digitalProductId;
        return state.offeringsByProductId[productId] ?? [];
      },
    },
    decisionPerspectiveProfile: {
      findUnique: async () => state.profile,
    },
    perspectiveMaterial: {
      upsert: async (args: unknown) => {
        writes.materials.push(args as Record<string, unknown>);
        return {};
      },
    },
    wikiPage: {
      findFirst: async (args: unknown) => {
        const slug = (args as { where: { slug: string } }).where.slug;
        return state.existingPages[slug] ?? null;
      },
      create: async (args: unknown) => {
        const a = args as { data: Record<string, unknown> };
        writes.pageCreates.push(a.data);
        return { id: `page-${nextId++}`, ...a.data };
      },
      update: async (args: unknown) => {
        const a = args as { data: Record<string, unknown>; where: Record<string, unknown> };
        writes.pageUpdates.push(a.data);
        return { id: (a.where as { id?: string }).id ?? "page-updated", ...a.data };
      },
    },
    wikiPageRevision: {
      findFirst: async () => null,
      create: async (args: unknown) => {
        writes.revisions.push((args as { data: Record<string, unknown> }).data);
        return {};
      },
    },
  };

  return { db, writes };
}

function baseState(): FakeState {
  return {
    orgName: "Emma3D",
    businessContext: {
      targetMarket: "hobbyist makers",
      portfolioDecomposition: {
        productsAndServicesSold: { scope: "primary", offerings: ["printed parts"] },
        manufactureAndDeliver: { scope: "standard" },
        forEmployees: { scope: "minimal" },
        foundational: { scope: "standard" },
      },
    },
    portfoliosBySlug: {
      products_and_services_sold: { id: "pf-sold" },
      manufacturing_and_delivery: { id: "pf-supply" },
      for_employees: { id: "pf-emp" },
    },
    productsByPortfolioId: {
      "pf-sold": [
        { id: "dp-1", productId: `DP-MARKET-OFFER-${ORG_ID}`, name: "3D Print Shop", description: null },
      ],
      "pf-supply": [
        { id: "dp-2", productId: "DP-SUPPLY-1", name: "Filament supplier", description: null },
      ],
      "pf-emp": [
        { id: "dp-3", productId: "DP-EMP-1", name: "Scheduling", description: null },
      ],
    },
    offeringsByProductId: {
      "dp-1": [{ name: "Custom print run" }, { name: "Design consultation" }],
    },
    existingPages: {},
    profile: { profileId: `org-perspective-${ORG_ID}`, currentVersionId: "v1" },
  };
}

const okEmbed = vi.fn(async () => true);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("seedOrgOperatingModelPages", () => {
  it("generates all three pages from a fully-mapped install and links materials", async () => {
    const { db, writes } = makeFakeDb(baseState());

    const res = await seedOrgOperatingModelPages({ organizationId: ORG_ID, db, embed: okEmbed });

    expect(res.written.sort()).toEqual([
      "org-how-we-are-organized",
      "org-tools-and-data",
      "org-what-we-sell",
    ]);
    expect(res.skippedNoData).toEqual([]);
    expect(res.embedded).toBe(true);
    expect(writes.pageCreates).toHaveLength(3);
    expect(writes.revisions).toHaveLength(3);
    expect(writes.materials).toHaveLength(3);

    const sell = writes.pageCreates.find((p) => p.slug === "org-what-we-sell");
    expect(sell).toBeDefined();
    expect(String(sell?.body)).toContain(OPERATING_MODEL_SEED_MARKER);
    // Catalog lines come from the market-offer ServiceOfferings, not the product name.
    expect(String(sell?.body)).toContain("Custom print run");
    expect(String(sell?.body)).toContain("hobbyist makers");
    expect(sell?.status).toBe("published");
    expect(sell?.organizationId).toBe(ORG_ID);
    expect(sell?.isKernel).toBe(false);
  });

  it("never overwrites an operator-edited page (marker gone)", async () => {
    const state = baseState();
    state.existingPages["org-what-we-sell"] = {
      id: "page-op",
      body: "# What we sell\n\nOur own words, hand-written.",
    };
    const { db, writes } = makeFakeDb(state);

    const res = await seedOrgOperatingModelPages({ organizationId: ORG_ID, db, embed: okEmbed });

    expect(res.preservedOperatorEdits).toEqual(["org-what-we-sell"]);
    expect(res.written).not.toContain("org-what-we-sell");
    expect(writes.pageCreates.map((p) => p.slug)).not.toContain("org-what-we-sell");
  });

  it("is a no-op for a marker-carrying page whose derived body is unchanged", async () => {
    const state = baseState();
    const { db } = makeFakeDb(state);
    const first = await seedOrgOperatingModelPages({ organizationId: ORG_ID, db, embed: okEmbed });
    expect(first.written).toHaveLength(3);

    // Simulate the pages now existing with exactly the generated bodies.
    const state2 = baseState();
    const { db: db2, writes: writes2 } = makeFakeDb(state2);
    const bodies: Record<string, string> = {};
    const capture = makeFakeDb(baseState());
    const generated = await seedOrgOperatingModelPages({
      organizationId: ORG_ID,
      db: capture.db,
      embed: okEmbed,
    });
    expect(generated.written).toHaveLength(3);
    for (const create of capture.writes.pageCreates) {
      bodies[String(create.slug)] = String(create.body);
    }
    state2.existingPages = Object.fromEntries(
      Object.entries(bodies).map(([slug, body], i) => [slug, { id: `page-${i}`, body }]),
    );

    const res = await seedOrgOperatingModelPages({ organizationId: ORG_ID, db: db2, embed: okEmbed });

    expect(res.written).toEqual([]);
    expect(res.preservedOperatorEdits).toEqual([]);
    expect(writes2.revisions).toHaveLength(0);
  });

  it("skips pages whose source data is absent instead of writing empty shells", async () => {
    const state = baseState();
    state.businessContext = { targetMarket: null, portfolioDecomposition: null };
    state.productsByPortfolioId = {};
    state.offeringsByProductId = {};
    const { db, writes } = makeFakeDb(state);

    const res = await seedOrgOperatingModelPages({ organizationId: ORG_ID, db, embed: okEmbed });

    expect(res.written).toEqual([]);
    expect(res.skippedNoData.sort()).toEqual([
      "org-how-we-are-organized",
      "org-tools-and-data",
      "org-what-we-sell",
    ]);
    expect(writes.pageCreates).toHaveLength(0);
    expect(writes.materials).toHaveLength(0);
  });

  it("still writes pages (with a warning-free result) when the org profile is missing, but links no materials", async () => {
    const state = baseState();
    state.profile = null;
    const { db, writes } = makeFakeDb(state);

    const res = await seedOrgOperatingModelPages({ organizationId: ORG_ID, db, embed: okEmbed });

    expect(res.written).toHaveLength(3);
    expect(writes.materials).toHaveLength(0);
  });

  it("reports embedded=false when the vector store write fails (fail-open)", async () => {
    const { db } = makeFakeDb(baseState());
    const failEmbed = vi.fn(async () => false);

    const res = await seedOrgOperatingModelPages({ organizationId: ORG_ID, db, embed: failEmbed });

    expect(res.written).toHaveLength(3);
    expect(res.embedded).toBe(false);
  });
});
