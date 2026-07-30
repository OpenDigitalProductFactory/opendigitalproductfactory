import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "operator" }) }),
}));

vi.mock(
  "@/lib/product-management/current-product-operating-context.server",
  () => ({
    ProductManagementAccessError: class extends Error {},
    ProductManagementOrganizationNotFoundError: class extends Error {},
    loadCurrentProductOperatingContextByKey: mocks.load,
  }),
);

vi.mock(
  "@/lib/product-management/product-operating-context-query",
  () => ({
    ProductOperatingContextNotFoundError: class extends Error {},
  }),
);

vi.mock("@/components/product/ProductLineComparison", () => ({
  ProductLineComparison: ({
    rows,
  }: {
    rows: Array<{ name: string }>;
  }) => <div data-comparison>{rows.map((row) => row.name).join(",")}</div>,
}));

vi.mock(
  "@/components/product/direction/ProductDirectionBrief",
  () => ({
    ProductDirectionBrief: () => <div data-direction-brief />,
  }),
);

import ProductLineDirectionPage from "./page";

describe("ProductLineDirectionPage", () => {
  it("leads with product comparison over the canonical product-line scope", async () => {
    const now = new Date("2026-07-28T20:00:00.000Z");
    const empty = (sourceKind: string) => ({
      availability: "available" as const,
      freshness: "unknown" as const,
      asOf: now,
      sourceKind,
      items: [],
      reason: null,
    });
    mocks.load.mockResolvedValue({
      scope: { kind: "product-line", id: "line-1" },
      requestedAt: now,
      provider: {
        id: "org-1",
        sourceKind: "organization",
        asOf: now,
        name: "Harbor Salon",
        derivedFromOrganization: true,
      },
      productLines: [],
      productLine: {
        id: "line-1",
        sourceKind: "product-line",
        asOf: now,
        name: "Salon services",
        parentId: null,
      },
      products: [
        {
          id: "product-1",
          productId: "PROD-1",
          productLineId: "line-1",
          sourceKind: "product",
          asOf: now,
          name: "Hair appointments",
        },
      ],
      consumers: empty("consumer"),
      enablingDigitalProducts: empty("digital"),
      offerings: empty("offering"),
      catalogItems: empty("catalog"),
      productSold: empty("sold"),
      commercialPerformance: {
        saleCount: 1,
        additiveRevenue: 80,
        currency: "USD",
        componentAllocations: [],
        unallocatedComponentCount: 0,
      },
      commercialPerformanceByProduct: [
        {
          productId: "product-1",
          saleCount: 1,
          additiveRevenue: 80,
          currency: "USD",
          unallocatedComponentCount: 0,
        },
      ],
      intelligence: empty("intelligence"),
      demand: empty("demand"),
      decisions: empty("decision"),
      objectives: empty("objective"),
      roadmapInputs: empty("roadmap"),
      deliveryChanges: empty("change"),
      architecture: empty("architecture"),
      scheduledPlaybooks: empty("schedule"),
    });

    const html = renderToStaticMarkup(
      await ProductLineDirectionPage({
        params: Promise.resolve({ id: "line-1" }),
      }),
    );

    expect(mocks.load).toHaveBeenCalledWith("product-line", "line-1");
    expect(html.indexOf("data-comparison")).toBeLessThan(
      html.indexOf("data-direction-brief"),
    );
    expect(html).toContain("Hair appointments");
  });
});
