import { describe, expect, it, vi } from "vitest";
import {
  ProductRouteAuthorityAmbiguousError,
  resolveProductRouteAuthority,
} from "./product-route-authority";

function db(input: {
  business?: {
    id: string;
    productId: string;
    name: string;
    description: string | null;
    productLine: { id: string; lineId: string; name: string };
    organization: { id: string; name: string };
  } | null;
  digital?: {
    id: string;
    productId: string;
    name: string;
    description: string | null;
    lifecycleStage: string;
    lifecycleStatus: string;
    version: string;
    portfolio: { name: string; slug: string } | null;
    taxonomyNode: { name: string; nodeId: string } | null;
  } | null;
}) {
  return {
    product: {
      findFirst: vi.fn().mockResolvedValue(input.business ?? null),
    },
    digitalProduct: {
      findUnique: vi.fn().mockResolvedValue(input.digital ?? null),
    },
  };
}

const business = {
  id: "business-product-1",
  productId: "PROD-SALON",
  name: "Hair appointments",
  description: "Cuts, colour, and styling.",
  productLine: {
    id: "line-services",
    lineId: "LINE-SERVICES",
    name: "Salon services",
  },
  organization: { id: "org-1", name: "Harbor Salon" },
};

const digital = {
  id: "digital-product-1",
  productId: "DP-BOOKING",
  name: "Booking portal",
  description: "Digital booking architecture.",
  lifecycleStage: "operate",
  lifecycleStatus: "active",
  version: "1.0.0",
  portfolio: { name: "Products and services sold", slug: "products_and_services_sold" },
  taxonomyNode: { name: "Booking", nodeId: "booking" },
};

describe("resolveProductRouteAuthority", () => {
  it("resolves a business Product only inside the authorized organization", async () => {
    const database = db({ business });

    await expect(
      resolveProductRouteAuthority({
        db: database,
        id: business.id,
        organizationId: "org-1",
      }),
    ).resolves.toEqual({ kind: "business-product", product: business });

    expect(database.product.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: business.id,
          organizationId: "org-1",
          effectiveTo: null,
        },
      }),
    );
  });

  it("preserves existing DigitalProduct resolution", async () => {
    await expect(
      resolveProductRouteAuthority({
        db: db({ digital }),
        id: digital.id,
        organizationId: "org-1",
      }),
    ).resolves.toEqual({ kind: "digital-product", product: digital });
  });

  it("returns null without revealing which authority missed", async () => {
    await expect(
      resolveProductRouteAuthority({
        db: db({}),
        id: "missing",
        organizationId: "org-1",
      }),
    ).resolves.toBeNull();
  });

  it("fails closed when both authorities match the same route identifier", async () => {
    await expect(
      resolveProductRouteAuthority({
        db: db({
          business: { ...business, id: "collision" },
          digital: { ...digital, id: "collision" },
        }),
        id: "collision",
        organizationId: "org-1",
      }),
    ).rejects.toBeInstanceOf(ProductRouteAuthorityAmbiguousError);
  });
});
