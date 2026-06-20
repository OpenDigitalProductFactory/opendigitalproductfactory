import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockPrisma,
  mockNanoid,
} = vi.hoisted(() => ({
  mockPrisma: {
    $transaction: vi.fn(),
  },
  mockNanoid: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: mockPrisma,
}));

vi.mock("nanoid", () => ({
  nanoid: mockNanoid,
}));

// The OVSM projection is covered by its own tests; mock it here so the reset
// test does not load the Prisma-client chain, and assert reset invokes it.
const { mockProjectOvs } = vi.hoisted(() => ({ mockProjectOvs: vi.fn() }));
vi.mock("./project-operational-value-stream", () => ({
  projectOperationalValueStreamForArchetype: mockProjectOvs,
}));

// Booking-seed is unit-tested in seed-booking-defaults.test.ts; mock it here so
// the reset test asserts the call contract without re-exercising provider seeding.
const { mockSeedBooking } = vi.hoisted(() => ({ mockSeedBooking: vi.fn() }));
vi.mock("./seed-booking-defaults", () => ({
  seedBookingScheduleDefaults: mockSeedBooking,
}));

import { resetStorefrontArchetype } from "./archetype-reset";

function businessCapabilityProjectionStore() {
  return {
    findMany: vi.fn().mockResolvedValue([]),
    upsert: vi.fn(async (args) => ({
      id: `db-${args.where.capabilityId}`,
      capabilityId: args.where.capabilityId,
    })),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  };
}

describe("resetStorefrontArchetype", () => {
  beforeEach(() => {
    mockNanoid.mockReset();
    mockPrisma.$transaction.mockReset();
    mockProjectOvs.mockReset();
    mockProjectOvs.mockResolvedValue({ viewId: "view-ovs" });
    mockSeedBooking.mockReset();
    mockSeedBooking.mockResolvedValue(false);
    mockNanoid.mockReturnValue("abcd1234");
  });

  it("re-syncs Organization.industry and BusinessContext.industry from the new archetype", async () => {
    const tx = {
      orgSettings: {
        findFirst: vi.fn().mockResolvedValue({ baseCurrency: "USD" }),
      },
      organization: {
        findUnique: vi.fn().mockResolvedValue({ id: "org_1", slug: "managing-digital", email: "ops@example.com", phone: "123" }),
        update: vi.fn().mockResolvedValue({}),
      },
      storefrontConfig: {
        findUnique: vi.fn().mockResolvedValue({ id: "sf_1", organizationId: "org_1" }),
        update: vi.fn().mockResolvedValue({}),
      },
      businessContext: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      storefrontArchetype: {
        findUnique: vi.fn().mockResolvedValue({
          id: "arch_1",
          archetypeId: "software-platform",
          category: "software-platform",
          ctaType: "inquiry",
          sectionTemplates: [{ type: "hero", title: "Hero", sortOrder: 0 }],
          itemTemplates: [{ name: "Open Digital Product Factory", description: "Platform", priceType: "quote", ctaType: "inquiry" }],
        }),
      },
      storefrontSection: {
        deleteMany: vi.fn().mockResolvedValue({ count: 4 }),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      storefrontItem: {
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn().mockResolvedValue({ count: 6 }),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      providerService: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      bookingHold: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      businessCapability: businessCapabilityProjectionStore(),
    };

    mockPrisma.$transaction.mockImplementation(async (fn: (trx: typeof tx) => Promise<unknown>) => fn(tx));

    await resetStorefrontArchetype({
      organizationId: "org_1",
      targetArchetypeId: "software-platform",
      mode: "replace-seeded-content",
    });

    expect(tx.organization.update).toHaveBeenCalledWith({
      where: { id: "org_1" },
      data: { industry: "software-platform" },
    });
    expect(tx.businessContext.updateMany).toHaveBeenCalledWith({
      where: { organizationId: "org_1" },
      data: { industry: "software-platform", ctaType: "inquiry" },
    });
    // Reset regenerates the operational value stream inside the transaction.
    expect(mockProjectOvs).toHaveBeenCalledWith({
      db: tx,
      organizationId: "org_1",
      archetypeId: "software-platform",
    });
  });

  it("replaces seeded items and sections when reset is run in replace mode", async () => {
    const tx = {
      orgSettings: {
        findFirst: vi.fn().mockResolvedValue({ baseCurrency: "USD" }),
      },
      organization: {
        findUnique: vi.fn().mockResolvedValue({ id: "org_1", slug: "old-slug", email: null, phone: null }),
        update: vi.fn().mockResolvedValue({}),
      },
      storefrontConfig: {
        findUnique: vi.fn().mockResolvedValue({ id: "sf_1", organizationId: "org_1" }),
        update: vi.fn().mockResolvedValue({}),
      },
      businessContext: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      storefrontArchetype: {
        findUnique: vi.fn().mockResolvedValue({
          id: "arch_1",
          archetypeId: "software-platform",
          category: "software-platform",
          ctaType: "inquiry",
          sectionTemplates: [
            { type: "hero", title: "Hero", sortOrder: 0 },
            { type: "items", title: "Platform Offers", sortOrder: 1 },
          ],
          itemTemplates: [
            { name: "Open Digital Product Factory", description: "Platform", priceType: "quote", ctaType: "inquiry" },
            { name: "Enablement", description: "Services", priceType: "quote", ctaType: "inquiry" },
          ],
        }),
      },
      storefrontSection: {
        deleteMany: vi.fn().mockResolvedValue({ count: 4 }),
        createMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      storefrontItem: {
        findMany: vi.fn().mockResolvedValue([{ id: "item_1" }, { id: "item_2" }]),
        deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
        createMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      providerService: {
        deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      bookingHold: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      businessCapability: businessCapabilityProjectionStore(),
    };

    mockPrisma.$transaction.mockImplementation(async (fn: (trx: typeof tx) => Promise<unknown>) => fn(tx));

    const result = await resetStorefrontArchetype({
      organizationId: "org_1",
      targetArchetypeId: "software-platform",
      mode: "replace-seeded-content",
    });

    expect(tx.storefrontSection.deleteMany).toHaveBeenCalledWith({ where: { storefrontId: "sf_1" } });
    expect(tx.storefrontSection.createMany).toHaveBeenCalled();
    expect(tx.storefrontItem.deleteMany).toHaveBeenCalledWith({ where: { storefrontId: "sf_1" } });
    expect(tx.storefrontItem.createMany).toHaveBeenCalled();
    expect(result.sectionsCreated).toBe(2);
    expect(result.itemsCreated).toBe(2);
    // Reset seeds booking schedule defaults inside the transaction so a booking
    // archetype gets a working calendar instead of an empty one (R9-RES-001).
    expect(mockSeedBooking).toHaveBeenCalledWith(tx, {
      storefrontId: "sf_1",
      archetypeId: "software-platform",
      providerName: "Bookings",
    });
  });

  it("preserves manually managed contact fields and org slug", async () => {
    const tx = {
      orgSettings: {
        findFirst: vi.fn().mockResolvedValue({ baseCurrency: "USD" }),
      },
      organization: {
        findUnique: vi.fn().mockResolvedValue({ id: "org_1", slug: "open-digital-product-factory", email: "ops@dpf.local", phone: "555-1234" }),
        update: vi.fn().mockResolvedValue({}),
      },
      storefrontConfig: {
        findUnique: vi.fn().mockResolvedValue({ id: "sf_1", organizationId: "org_1" }),
        update: vi.fn().mockResolvedValue({}),
      },
      businessContext: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      storefrontArchetype: {
        findUnique: vi.fn().mockResolvedValue({
          id: "arch_1",
          archetypeId: "software-platform",
          category: "software-platform",
          ctaType: "inquiry",
          sectionTemplates: [{ type: "hero", title: "Hero", sortOrder: 0 }],
          itemTemplates: [{ name: "Open Digital Product Factory", description: "Platform", priceType: "quote", ctaType: "inquiry" }],
        }),
      },
      storefrontSection: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      storefrontItem: {
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      providerService: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      bookingHold: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      businessCapability: businessCapabilityProjectionStore(),
    };

    mockPrisma.$transaction.mockImplementation(async (fn: (trx: typeof tx) => Promise<unknown>) => fn(tx));

    await resetStorefrontArchetype({
      organizationId: "org_1",
      targetArchetypeId: "software-platform",
      mode: "replace-seeded-content",
    });

    expect(tx.organization.update).toHaveBeenCalledWith({
      where: { id: "org_1" },
      data: { industry: "software-platform" },
    });
  });

  it("preserves operator-owned identity and reports it when none is supplied (AUDIT-R1S-001)", async () => {
    const tx = {
      orgSettings: { findFirst: vi.fn().mockResolvedValue({ baseCurrency: "USD" }) },
      organization: {
        findUnique: vi.fn().mockResolvedValue({
          id: "org_1",
          name: "Riverside Plumbing Solutions",
          slug: "riverside-plumbing-solutions",
        }),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue({}),
      },
      storefrontConfig: {
        findUnique: vi.fn().mockResolvedValue({
          id: "sf_1",
          organizationId: "org_1",
          tagline: "Fast, reliable plumbing for homes and businesses in Riverside",
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      businessContext: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      storefrontArchetype: {
        findUnique: vi.fn().mockResolvedValue({
          id: "arch_1",
          archetypeId: "electrician",
          category: "trades-maintenance",
          ctaType: "inquiry",
          sectionTemplates: [{ type: "hero", title: "Hero", sortOrder: 0 }],
          itemTemplates: [{ name: "Panel upgrade", priceType: "quote", ctaType: "inquiry" }],
        }),
      },
      storefrontSection: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      storefrontItem: {
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      providerService: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      bookingHold: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      businessCapability: businessCapabilityProjectionStore(),
    };
    mockPrisma.$transaction.mockImplementation(async (fn: (trx: typeof tx) => Promise<unknown>) => fn(tx));

    const result = await resetStorefrontArchetype({
      organizationId: "org_1",
      targetArchetypeId: "electrician",
      mode: "replace-seeded-content",
    });

    // Identity is operator-owned, so the swap must NOT auto-clobber it...
    expect(tx.organization.update).toHaveBeenCalledWith({
      where: { id: "org_1" },
      data: { industry: "trades-maintenance" },
    });
    expect(tx.organization.findFirst).not.toHaveBeenCalled();
    // ...but it MUST be reported so the caller can prompt the operator instead
    // of silently presenting the prior identity to customers (AUDIT-R1S-001).
    expect(result.identity.updated).toEqual([]);
    expect(result.identity.preserved).toEqual(["orgName", "slug", "tagline"]);
    expect(result.identity.orgName).toBe("Riverside Plumbing Solutions");
    expect(result.identity.slug).toBe("riverside-plumbing-solutions");
    expect(result.warnings.some((w) => /preserved across the archetype change/i.test(w))).toBe(true);
  });

  it("applies supplied identity (name, slug, tagline) and marks them updated", async () => {
    const tx = {
      orgSettings: { findFirst: vi.fn().mockResolvedValue({ baseCurrency: "USD" }) },
      organization: {
        findUnique: vi.fn().mockResolvedValue({
          id: "org_1",
          name: "Riverside Plumbing Solutions",
          slug: "riverside-plumbing-solutions",
        }),
        findFirst: vi.fn().mockResolvedValue(null), // requested slug is free
        update: vi.fn().mockResolvedValue({}),
      },
      storefrontConfig: {
        findUnique: vi.fn().mockResolvedValue({ id: "sf_1", organizationId: "org_1", tagline: "old" }),
        update: vi.fn().mockResolvedValue({}),
      },
      businessContext: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      storefrontArchetype: {
        findUnique: vi.fn().mockResolvedValue({
          id: "arch_1",
          archetypeId: "electrician",
          category: "trades-maintenance",
          ctaType: "inquiry",
          sectionTemplates: [{ type: "hero", title: "Hero", sortOrder: 0 }],
          itemTemplates: [{ name: "Panel upgrade", priceType: "quote", ctaType: "inquiry" }],
        }),
      },
      storefrontSection: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      storefrontItem: {
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      providerService: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      bookingHold: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      businessCapability: businessCapabilityProjectionStore(),
    };
    mockPrisma.$transaction.mockImplementation(async (fn: (trx: typeof tx) => Promise<unknown>) => fn(tx));

    const result = await resetStorefrontArchetype({
      organizationId: "org_1",
      targetArchetypeId: "electrician",
      mode: "replace-seeded-content",
      identity: {
        orgName: "Riverside Electric Co.",
        slug: "riverside-electric",
        tagline: "Licensed electricians for homes and businesses",
      },
    });

    expect(tx.organization.findFirst).toHaveBeenCalledWith({
      where: { slug: "riverside-electric", NOT: { id: "org_1" } },
      select: { id: true },
    });
    expect(tx.organization.update).toHaveBeenCalledWith({
      where: { id: "org_1" },
      data: { industry: "trades-maintenance", name: "Riverside Electric Co.", slug: "riverside-electric" },
    });
    expect(tx.storefrontConfig.update).toHaveBeenCalledWith({
      where: { id: "sf_1" },
      data: { archetypeId: "arch_1", tagline: "Licensed electricians for homes and businesses" },
    });
    expect([...result.identity.updated].sort()).toEqual(["orgName", "slug", "tagline"]);
    expect(result.identity.preserved).toEqual([]);
    expect(result.identity.orgName).toBe("Riverside Electric Co.");
    expect(result.identity.slug).toBe("riverside-electric");
    expect(result.identity.tagline).toBe("Licensed electricians for homes and businesses");
  });

  it("does not overwrite a slug already taken by another org", async () => {
    const tx = {
      orgSettings: { findFirst: vi.fn().mockResolvedValue({ baseCurrency: "USD" }) },
      organization: {
        findUnique: vi.fn().mockResolvedValue({ id: "org_1", name: "Acme", slug: "acme" }),
        findFirst: vi.fn().mockResolvedValue({ id: "org_2" }), // requested slug is taken
        update: vi.fn().mockResolvedValue({}),
      },
      storefrontConfig: {
        findUnique: vi.fn().mockResolvedValue({ id: "sf_1", organizationId: "org_1", tagline: null }),
        update: vi.fn().mockResolvedValue({}),
      },
      businessContext: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      storefrontArchetype: {
        findUnique: vi.fn().mockResolvedValue({
          id: "arch_1",
          archetypeId: "electrician",
          category: "trades-maintenance",
          ctaType: "inquiry",
          sectionTemplates: [],
          itemTemplates: [],
        }),
      },
      storefrontSection: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      storefrontItem: {
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      providerService: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      bookingHold: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      businessCapability: businessCapabilityProjectionStore(),
    };
    mockPrisma.$transaction.mockImplementation(async (fn: (trx: typeof tx) => Promise<unknown>) => fn(tx));

    const result = await resetStorefrontArchetype({
      organizationId: "org_1",
      targetArchetypeId: "electrician",
      mode: "replace-seeded-content",
      identity: { slug: "taken-slug" },
    });

    expect(tx.organization.update).toHaveBeenCalledWith({
      where: { id: "org_1" },
      data: { industry: "trades-maintenance" },
    });
    expect(result.identity.slug).toBe("acme");
    expect(result.identity.updated).not.toContain("slug");
    expect(result.warnings.some((w) => /already in use/i.test(w))).toBe(true);
  });

  it("refuses to run when the target archetype is missing", async () => {
    const tx = {
      organization: {
        findUnique: vi.fn().mockResolvedValue({ id: "org_1" }),
      },
      storefrontConfig: {
        findUnique: vi.fn().mockResolvedValue({ id: "sf_1", organizationId: "org_1" }),
      },
      storefrontArchetype: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };

    mockPrisma.$transaction.mockImplementation(async (fn: (trx: typeof tx) => Promise<unknown>) => fn(tx));

    await expect(
      resetStorefrontArchetype({
        organizationId: "org_1",
        targetArchetypeId: "software-platform",
        mode: "replace-seeded-content",
      }),
    ).rejects.toThrow(/target archetype/i);
  });
});
