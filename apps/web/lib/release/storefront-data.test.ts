import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  };
});

vi.mock("@dpf/db", () => ({
  prisma: {
    storefrontConfig: {
      findFirst: vi.fn(),
    },
    storefrontItem: {
      findFirst: vi.fn(),
    },
    organization: {
      findFirst: vi.fn(),
    },
  },
}));

import { getPublicStorefront, getPublicItem } from "./storefront-data";
import { prisma } from "@dpf/db";

const mockStorefront = {
  isPublished: true,
  tagline: "Care you can trust",
  description: null,
  heroImageUrl: null,
  contactEmail: "info@example.com",
  contactPhone: null,
  socialLinks: null,
  archetype: { archetypeId: "veterinary-clinic" },
  organization: {
    name: "Acme Vet",
    slug: "acme-vet",
    logoUrl: null,
    address: null,
    brandingConfig: null,
  },
  sections: [],
  items: [],
};

describe("getPublicStorefront", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns null when storefront is unpublished", async () => {
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue({
      ...mockStorefront,
      isPublished: false,
    } as never);

    const result = await getPublicStorefront("acme-vet");
    expect(result).toBeNull();
  });

  it("returns PublicStorefrontConfig when published", async () => {
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue(
      mockStorefront as never
    );

    const result = await getPublicStorefront("acme-vet");
    expect(result).not.toBeNull();
    expect(result?.orgName).toBe("Acme Vet");
    expect(result?.orgSlug).toBe("acme-vet");
    expect(result?.archetypeId).toBe("veterinary-clinic");
  });

  it("returns only the items provided by the DB query (isActive filtered at DB level)", async () => {
    // The query uses where: { isActive: true } — mock simulates the DB returning only active items.
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue({
      ...mockStorefront,
      items: [
        { id: "1", itemId: "itm-1", name: "Active", ctaType: "booking", sortOrder: 0, description: null, category: null, priceAmount: null, priceCurrency: "GBP", priceType: null, imageUrl: null, ctaLabel: null, bookingConfig: null },
      ],
    } as never);

    const result = await getPublicStorefront("acme-vet");
    expect(result?.items).toHaveLength(1);
    expect(result?.items[0]?.name).toBe("Active");
  });

  it("returns published software-platform storefront data without special-case breakage", async () => {
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue({
      ...mockStorefront,
      tagline: "Run your digital product operation on the platform that runs itself.",
      archetype: { archetypeId: "software-platform" },
      items: [
        {
          id: "1",
          itemId: "itm-1",
          name: "Open Digital Product Factory",
          ctaType: "inquiry",
          sortOrder: 0,
          description: "AI-native platform for governed delivery",
          category: "Platform",
          priceAmount: null,
          priceCurrency: "GBP",
          priceType: "quote",
          imageUrl: null,
          ctaLabel: "Start a conversation",
          bookingConfig: null,
        },
      ],
    } as never);

    const result = await getPublicStorefront("acme-vet");
    expect(result?.archetypeId).toBe("software-platform");
    expect(result?.items[0]?.ctaType).toBe("inquiry");
    expect(result?.items[0]?.name).toBe("Open Digital Product Factory");
  });
});
