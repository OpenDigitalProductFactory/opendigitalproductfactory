import { describe, expect, it } from "vitest";
import {
  assembleProductOperatingContext,
  classifyContextFreshness,
  collectProductLineSubtreeIds,
  createContextSlice,
  type ProductOperatingContextInput,
} from "./product-operating-context";

const now = new Date("2026-07-28T20:00:00.000Z");

function item(
  id: string,
  sourceKind: string,
  daysOld = 0,
): { id: string; sourceKind: string; asOf: Date } {
  return {
    id,
    sourceKind,
    asOf: new Date(now.getTime() - daysOld * 86_400_000),
  };
}

function baseInput(
  overrides: Partial<ProductOperatingContextInput> = {},
): ProductOperatingContextInput {
  return {
    requestedAt: now,
    scope: { kind: "product", id: "product-salon-services" },
    organization: {
      ...item("org-1", "organization"),
      name: "Harbor Salon",
    },
    productLine: {
      ...item("line-services", "product-line"),
      name: "Salon services",
      parentId: null,
    },
    productLines: [
      {
        ...item("line-services", "product-line"),
        name: "Salon services",
        parentId: null,
      },
    ],
    products: [
      {
        ...item("product-salon-services", "product"),
        productId: "PROD-SALON",
        productLineId: "line-services",
        name: "Hair appointments",
      },
    ],
    enablingDigitalProducts: createContextSlice({
      requestedAt: now,
      sourceKind: "operational-service-offering",
      items: [],
      unavailableReason: "No explicit enabling digital-product link exists.",
    }),
    offerings: createContextSlice({
      requestedAt: now,
      sourceKind: "product-offering",
      items: [
        {
          ...item("offering-1", "product-offering"),
          productId: "product-salon-services",
          providerOrganizationId: "org-1",
          name: "Book an appointment",
          status: "active",
        },
      ],
    }),
    catalogItems: createContextSlice({
      requestedAt: now,
      sourceKind: "catalog-item",
      items: [
        {
          ...item("catalog-1", "catalog-item"),
          productId: "product-salon-services",
          name: "Haircut",
          status: "active",
        },
      ],
    }),
    productSold: createContextSlice({
      requestedAt: now,
      sourceKind: "product-sold",
      items: [],
    }),
    intelligence: createContextSlice({
      requestedAt: now,
      sourceKind: "research-proposal",
      items: [],
    }),
    demand: createContextSlice({
      requestedAt: now,
      sourceKind: "backlog-item",
      items: [],
    }),
    decisions: createContextSlice({
      requestedAt: now,
      sourceKind: "decision-interaction",
      items: [],
      unavailableReason: "No typed product decision association exists.",
    }),
    objectives: createContextSlice({
      requestedAt: now,
      sourceKind: "product-objective",
      items: [],
      unavailableReason: "Product objectives are introduced in Phase 9.",
    }),
    roadmapInputs: createContextSlice({
      requestedAt: now,
      sourceKind: "epic",
      items: [],
    }),
    deliveryChanges: createContextSlice({
      requestedAt: now,
      sourceKind: "change-item",
      items: [],
    }),
    architecture: createContextSlice({
      requestedAt: now,
      sourceKind: "ea-element",
      items: [],
    }),
    scheduledPlaybooks: createContextSlice({
      requestedAt: now,
      sourceKind: "scheduled-agent-task",
      items: [],
      unavailableReason: "No typed product schedule association exists.",
    }),
    ...overrides,
  };
}

describe("ProductOperatingContext", () => {
  it("defaults a simple business to the organization provider without inventing consumers or teams", () => {
    const context = assembleProductOperatingContext(baseInput());

    expect(context.provider).toEqual({
      id: "org-1",
      sourceKind: "organization",
      asOf: now,
      name: "Harbor Salon",
      derivedFromOrganization: true,
    });
    expect(context.consumers.items).toEqual([]);
    expect(context.consumers.availability).toBe("available");
    expect(context.consumers.freshness).toBe("unknown");
    expect("productTeam" in context).toBe(false);
    expect("businessUnit" in context).toBe(false);
  });

  it("derives consumers only from real Product Sold party or transaction evidence", () => {
    const context = assembleProductOperatingContext(
      baseInput({
        productSold: createContextSlice({
          requestedAt: now,
          sourceKind: "product-sold",
          items: [
            {
              ...item("sold-1", "product-sold"),
              productId: "product-salon-services",
              status: "fulfilled",
              quantity: 1,
              totalAmount: 80,
              currency: "USD",
              consumerEvidence: [
                {
                  ...item("party-contact-1", "product-sold-party"),
                  role: "consumer",
                  label: "Riley",
                  canonicalLinkEstablished: true,
                },
              ],
              componentAllocations: [],
            },
          ],
        }),
      }),
    );

    expect(context.consumers.items).toEqual([
      expect.objectContaining({
        id: "party-contact-1",
        role: "consumer",
        label: "Riley",
        sourceKind: "product-sold-party",
      }),
    ]);
  });

  it("keeps organization-wide and product-specific intelligence distinguishable", () => {
    const context = assembleProductOperatingContext(
      baseInput({
        enablingDigitalProducts: createContextSlice({
          requestedAt: now,
          sourceKind: "operational-service-offering",
          items: [
            {
              ...item("digital-booking", "digital-product"),
              productId: "DP-BOOKING",
              name: "Booking portal",
            },
          ],
        }),
        intelligence: createContextSlice({
          requestedAt: now,
          sourceKind: "research-proposal",
          items: [
            {
              ...item("research-org", "research-proposal"),
              title: "Local salon market",
              scope: "organization",
              digitalProductId: null,
              status: "executed",
            },
            {
              ...item("research-product", "research-proposal"),
              title: "Booking conversion",
              scope: "digital-product",
              digitalProductId: "digital-booking",
              status: "executed",
            },
          ],
        }),
      }),
    );

    expect(context.intelligence.items.map((entry) => entry.scope)).toEqual([
      "digital-product",
      "organization",
    ]);
  });

  it("prioritizes business product, product-line, digital, then organization evidence", () => {
    const intelligence = createContextSlice({
      requestedAt: now,
      sourceKind: "research-proposal",
      items: [
        {
          ...item("org", "research-proposal"),
          title: "Whole business",
          scope: "organization" as const,
          digitalProductId: null,
          status: "executed",
        },
        {
          ...item("digital", "research-proposal"),
          title: "Booking architecture",
          scope: "digital-product" as const,
          digitalProductId: "digital-1",
          status: "executed",
        },
        {
          ...item("line", "research-proposal"),
          title: "Salon services",
          scope: "product-line" as const,
          productLineId: "line-services",
          digitalProductId: null,
          status: "executed",
        },
        {
          ...item("product", "research-proposal"),
          title: "Hair appointments",
          scope: "business-product" as const,
          businessProductId: "product-salon-services",
          digitalProductId: null,
          status: "executed",
        },
      ],
    });

    const context = assembleProductOperatingContext(baseInput({ intelligence }));
    expect(context.intelligence.items.map((entry) => entry.id)).toEqual([
      "product",
      "line",
      "digital",
      "org",
    ]);
  });

  it("reports direct revenue once and package allocation as non-additive attribution", () => {
    const context = assembleProductOperatingContext(
      baseInput({
        productSold: createContextSlice({
          requestedAt: now,
          sourceKind: "product-sold",
          items: [
            {
              ...item("sold-package", "product-sold"),
              productId: "product-salon-services",
              status: "fulfilled",
              quantity: 1,
              totalAmount: 120,
              currency: "USD",
              consumerEvidence: [],
              componentAllocations: [
                {
                  catalogItemId: "catalog-haircut",
                  allocatedAmount: 75,
                },
                {
                  catalogItemId: "catalog-retail",
                  allocatedAmount: 45,
                },
              ],
            },
          ],
        }),
      }),
    );

    expect(context.commercialPerformance).toEqual({
      saleCount: 1,
      additiveRevenue: 120,
      currency: "USD",
      componentAllocations: [
        {
          catalogItemId: "catalog-haircut",
          allocatedAmount: 75,
          additive: false,
        },
        {
          catalogItemId: "catalog-retail",
          allocatedAmount: 45,
          additive: false,
        },
      ],
      unallocatedComponentCount: 0,
    });
  });

  it("surfaces unavailable and stale evidence honestly", () => {
    const context = assembleProductOperatingContext(
      baseInput({
        decisions: createContextSlice({
          requestedAt: now,
          sourceKind: "decision-interaction",
          items: [],
          unavailableReason: "No typed product decision association exists.",
        }),
        demand: createContextSlice({
          requestedAt: now,
          sourceKind: "backlog-item",
          staleAfterDays: 30,
          items: [
            {
              ...item("BI-OLD", "backlog-item", 45),
              title: "Old signal",
              status: "open",
            },
          ],
        }),
      }),
    );

    expect(context.decisions).toMatchObject({
      availability: "unavailable",
      reason: "No typed product decision association exists.",
    });
    expect(context.demand.freshness).toBe("stale");
    expect(classifyContextFreshness(now, now, 30)).toBe("fresh");
  });

  it("sorts every evidence slice deterministically by asOf then canonical id", () => {
    const slice = createContextSlice({
      requestedAt: now,
      sourceKind: "backlog-item",
      items: [
        { ...item("B", "backlog-item", 1), title: "B", status: "open" },
        { ...item("C", "backlog-item"), title: "C", status: "open" },
        { ...item("A", "backlog-item"), title: "A", status: "open" },
      ],
    });

    expect(slice.items.map((entry) => entry.id)).toEqual(["A", "C", "B"]);
  });

  it("resolves deterministic nested product-line rollups without looping on malformed cycles", () => {
    expect(
      collectProductLineSubtreeIds(
        [
          { id: "rooms", parentId: "hospitality" },
          { id: "conference-breakouts", parentId: "events" },
          { id: "hospitality", parentId: null },
          { id: "events", parentId: "hospitality" },
        ],
        "hospitality",
      ),
    ).toEqual([
      "hospitality",
      "events",
      "rooms",
      "conference-breakouts",
    ]);

    expect(
      collectProductLineSubtreeIds(
        [
          { id: "a", parentId: "b" },
          { id: "b", parentId: "a" },
        ],
        "a",
      ),
    ).toEqual(["a", "b"]);
  });

  it("classifies slice freshness from the same newest evidence exposed as asOf", () => {
    const slice = createContextSlice({
      requestedAt: now,
      sourceKind: "backlog-item",
      staleAfterDays: 30,
      items: [
        { ...item("fresh", "backlog-item"), title: "Fresh", status: "open" },
        {
          ...item("stale", "backlog-item", 45),
          title: "Stale",
          status: "open",
        },
      ],
    });

    expect(slice.asOf).toEqual(now);
    expect(slice.freshness).toBe("fresh");
  });

  it("preserves unallocated package components as an explicit reporting blind spot", () => {
    const context = assembleProductOperatingContext(
      baseInput({
        productSold: createContextSlice({
          requestedAt: now,
          sourceKind: "product-sold",
          items: [
            {
              ...item("sold-package", "product-sold"),
              productId: "product-salon-services",
              status: "fulfilled",
              quantity: 1,
              totalAmount: 120,
              currency: "USD",
              consumerEvidence: [],
              componentAllocations: [
                {
                  catalogItemId: "catalog-haircut",
                  allocatedAmount: null,
                  allocationMode: "unallocated",
                },
              ],
            },
          ],
        }),
      }),
    );

    expect(context.productSold.items[0]?.componentAllocations).toEqual([
      {
        catalogItemId: "catalog-haircut",
        allocatedAmount: null,
        allocationMode: "unallocated",
      },
    ]);
    expect(context.commercialPerformance).toMatchObject({
      additiveRevenue: 120,
      componentAllocations: [],
      unallocatedComponentCount: 1,
    });
  });

  it("projects stable per-product commercial comparisons from the same Product Sold evidence", () => {
    const retailProduct = {
      ...item("product-retail", "product"),
      productId: "PROD-RETAIL",
      productLineId: "line-retail",
      name: "Salon retail",
    };
    const context = assembleProductOperatingContext(
      baseInput({
        products: [...baseInput().products, retailProduct],
        productSold: createContextSlice({
          requestedAt: now,
          sourceKind: "product-sold",
          items: [
            {
              ...item("sold-service", "product-sold"),
              productId: "product-salon-services",
              status: "fulfilled",
              quantity: 1,
              totalAmount: 80,
              currency: "USD",
              consumerEvidence: [],
              componentAllocations: [],
            },
            {
              ...item("sold-retail-2", "product-sold"),
              productId: "product-retail",
              status: "fulfilled",
              quantity: 1,
              totalAmount: 30,
              currency: "USD",
              consumerEvidence: [],
              componentAllocations: [],
            },
            {
              ...item("sold-retail-1", "product-sold"),
              productId: "product-retail",
              status: "fulfilled",
              quantity: 2,
              totalAmount: 45,
              currency: "CAD",
              consumerEvidence: [],
              componentAllocations: [
                {
                  catalogItemId: "catalog-shampoo",
                  allocatedAmount: null,
                  allocationMode: "unallocated",
                },
              ],
            },
          ],
        }),
      }),
    );

    expect(context.commercialPerformanceByProduct).toEqual([
      {
        productId: "product-retail",
        saleCount: 2,
        additiveRevenue: 75,
        currency: null,
        unallocatedComponentCount: 1,
      },
      {
        productId: "product-salon-services",
        saleCount: 1,
        additiveRevenue: 80,
        currency: "USD",
        unallocatedComponentCount: 0,
      },
    ]);
  });
});
