import { describe, expect, it, vi } from "vitest";

import { loadDigitalProductOperationalOfferings } from "./operational-offerings";

describe("DigitalProduct operational offering view", () => {
  it("keeps operational commitments primary and exposes only real commercial traces", async () => {
    const productFind = vi.fn().mockResolvedValue({ id: "digital-product-row" });
    const offeringFind = vi.fn().mockResolvedValue([
      {
        id: "service-row",
        offeringId: "SVC-GOLD",
        name: "Gold support",
        description: "Twenty-four hour response commitment",
        availabilityTarget: 99.9,
        mttrHours: 2,
        rtoHours: 4,
        rpoHours: 1,
        supportHours: "24x7",
        status: "active",
        commercialOffering: {
          offeringId: "OFFER-GOLD",
          catalogItems: [
            {
              catalogItemId: "CAT-GOLD",
              name: "Gold support",
              status: "active",
            },
          ],
        },
      },
    ]);

    await expect(
      loadDigitalProductOperationalOfferings(
        {
          digitalProduct: { findUnique: productFind },
          serviceOffering: { findMany: offeringFind },
        },
        "digital-product-row",
      ),
    ).resolves.toEqual({
      exists: true,
      offerings: [
        expect.objectContaining({
          offeringId: "SVC-GOLD",
          availabilityTarget: 99.9,
          commercialTrace: {
            offeringId: "OFFER-GOLD",
            catalogItems: [
              {
                catalogItemId: "CAT-GOLD",
                name: "Gold support",
                status: "active",
              },
            ],
          },
        }),
      ],
    });

    expect(offeringFind).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { digitalProductId: "digital-product-row" },
        select: expect.objectContaining({
          availabilityTarget: true,
          commercialOffering: {
            select: {
              offeringId: true,
              catalogItems: {
                orderBy: { name: "asc" },
                select: {
                  catalogItemId: true,
                  name: true,
                  status: true,
                },
              },
            },
          },
        }),
      }),
    );
  });

  it("does not infer a commercial trace for an unlinked operational offering", async () => {
    const result = await loadDigitalProductOperationalOfferings(
      {
        digitalProduct: {
          findUnique: vi.fn().mockResolvedValue({ id: "digital-product-row" }),
        },
        serviceOffering: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: "service-row",
              offeringId: "SVC-STANDARD",
              name: "Standard support",
              description: null,
              availabilityTarget: null,
              mttrHours: null,
              rtoHours: null,
              rpoHours: null,
              supportHours: null,
              status: "draft",
              commercialOffering: null,
            },
          ]),
        },
      },
      "digital-product-row",
    );

    expect(result.offerings[0]?.commercialTrace).toBeNull();
  });
});
