import { beforeEach, describe, expect, it, vi } from "vitest";

const mockNanoid = vi.hoisted(() => vi.fn(() => "abc123def456"));
vi.mock("@/lib/shared/new-id", () => ({ newId: mockNanoid }));

import { seedBeautyCapacityDefaults } from "./seed-beauty-capacity-defaults";

function database() {
  return {
    storefrontItem: {
      findMany: vi.fn(async () => [
        { id: "item-manicure", name: "Manicure" },
        { id: "item-pedicure", name: "Pedicure" },
      ]),
    },
    beautyResource: {
      count: vi.fn(async () => 0),
      upsert: vi.fn(async ({ create }: { create: { resourceId: string } }) => ({ id: create.resourceId })),
    },
    beautyResourceService: { createMany: vi.fn(async () => ({ count: 1 })) },
    beautyResourceAvailability: {
      count: vi.fn(async () => 0),
      create: vi.fn(async () => ({})),
    },
  };
}

describe("seedBeautyCapacityDefaults", () => {
  beforeEach(() => mockNanoid.mockClear());

  it("seeds stable nail and pedicure stations with explicit service eligibility", async () => {
    const db = database();
    await expect(seedBeautyCapacityDefaults(db, {
      organizationId: "org-1",
      storefrontId: "storefront-1",
      archetypeId: "nail-salon",
    })).resolves.toBe(true);

    expect(db.beautyResource.upsert).toHaveBeenCalledTimes(5);
    expect(db.beautyResource.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { storefrontId_resourceId: { storefrontId: "storefront-1", resourceId: "pedicure-station-1" } },
      create: expect.objectContaining({ kind: "station", label: "Pedicure Station 1" }),
      update: {},
    }));
    expect(db.beautyResourceService.createMany).toHaveBeenCalledWith({
      data: [{ storefrontId: "storefront-1", resourceId: "pedicure-station-1", itemId: "item-pedicure" }],
      skipDuplicates: true,
    });
    expect(db.beautyResourceAvailability.create).toHaveBeenCalled();
  });

  it("preserves operator-authored availability", async () => {
    const db = database();
    db.beautyResourceAvailability.count.mockResolvedValue(1);

    await seedBeautyCapacityDefaults(db, {
      organizationId: "org-1",
      storefrontId: "storefront-1",
      archetypeId: "hair-salon",
    });

    expect(db.beautyResourceAvailability.create).not.toHaveBeenCalled();
  });

  it("does not manufacture fixed resources for mobile beauty", async () => {
    const db = database();
    await expect(seedBeautyCapacityDefaults(db, {
      organizationId: "org-1",
      storefrontId: "storefront-1",
      archetypeId: "mobile-beauty",
    })).resolves.toBe(false);
    expect(db.beautyResource.upsert).not.toHaveBeenCalled();
  });
});
