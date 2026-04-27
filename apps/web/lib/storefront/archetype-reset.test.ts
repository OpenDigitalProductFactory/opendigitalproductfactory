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

import { resetStorefrontArchetype } from "./archetype-reset";

describe("resetStorefrontArchetype", () => {
  beforeEach(() => {
    mockNanoid.mockReset();
    mockPrisma.$transaction.mockReset();
    mockNanoid.mockReturnValue("abcd1234");
  });

  it("re-syncs Organization.industry and BusinessContext.industry from the new archetype", async () => {
    const tx = {
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
  });

  it("replaces seeded items and sections when reset is run in replace mode", async () => {
    const tx = {
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
  });

  it("preserves manually managed contact fields and org slug", async () => {
    const tx = {
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
