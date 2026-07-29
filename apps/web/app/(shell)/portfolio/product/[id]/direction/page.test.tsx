import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  navMode: "worker",
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => ({ value: mocks.navMode }),
  }),
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

vi.mock(
  "@/components/product/direction/ProductDirectionBrief",
  () => ({
    ProductDirectionBrief: ({
      view,
    }: {
      view: { audience: string; sections: Array<{ kind: string }> };
    }) => (
      <div data-audience={view.audience}>
        {view.sections.map((section) => (
          <span key={section.kind}>{section.kind}</span>
        ))}
      </div>
    ),
  }),
);
vi.mock(
  "@/components/product/direction/ProductManagementPlaybooks",
  () => ({
    ProductManagementPlaybooks: ({ audience }: { audience: string }) => (
      <div data-playbook-audience={audience}>playbooks</div>
    ),
  }),
);
vi.mock(
  "@/lib/product-management/product-management-brief",
  () => ({
    buildStakeholderBriefFromOperatingContext: () => ({
      schemaVersion: 1,
      importable: false,
    }),
  }),
);

import ProductDirectionPage from "./page";

const now = new Date("2026-07-28T20:00:00.000Z");
const empty = (sourceKind: string) => ({
  availability: "available" as const,
  freshness: "unknown" as const,
  asOf: now,
  sourceKind,
  items: [],
  reason: null,
});

beforeEach(() => {
  mocks.navMode = "worker";
  mocks.load.mockReset();
  mocks.load.mockResolvedValue({
    scope: { kind: "product", id: "product-1" },
    requestedAt: now,
    provider: {
      id: "org-1",
      sourceKind: "organization",
      asOf: now,
      name: "Harbor Salon",
      derivedFromOrganization: true,
    },
    productLines: [],
    productLine: null,
    products: [],
    consumers: empty("consumer"),
    enablingDigitalProducts: empty("digital-product"),
    offerings: empty("offering"),
    catalogItems: empty("catalog"),
    productSold: empty("sold"),
    commercialPerformance: {
      saleCount: 0,
      additiveRevenue: 0,
      currency: null,
      componentAllocations: [],
      unallocatedComponentCount: 0,
    },
    commercialPerformanceByProduct: [],
    intelligence: empty("intelligence"),
    demand: empty("demand"),
    decisions: empty("decision"),
    objectives: {
      ...empty("objective"),
      availability: "unavailable",
      reason: "Not active yet.",
    },
    roadmapInputs: empty("roadmap"),
    deliveryChanges: empty("change"),
    architecture: empty("architecture"),
    scheduledPlaybooks: {
      ...empty("schedule"),
      availability: "unavailable",
      reason: "Not active yet.",
    },
  });
});

describe("ProductDirectionPage", () => {
  it("loads the canonical product scope and uses guided density in worker mode", async () => {
    const html = renderToStaticMarkup(
      await ProductDirectionPage({
        params: Promise.resolve({ id: "product-1" }),
      }),
    );

    expect(mocks.load).toHaveBeenCalledWith("product", "product-1");
    expect(html).toContain('data-audience="guided"');
    expect(html.indexOf("needs-decision")).toBeLessThan(
      html.indexOf("evidence-delta"),
    );
  });

  it("uses professional density in operator mode over the same projection", async () => {
    mocks.navMode = "operator";
    const html = renderToStaticMarkup(
      await ProductDirectionPage({
        params: Promise.resolve({ id: "product-1" }),
      }),
    );

    expect(html).toContain('data-audience="professional"');
    expect(mocks.load).toHaveBeenCalledTimes(1);
  });
});
