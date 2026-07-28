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
vi.mock("@/components/product/intelligence/ProductIntelligence", () => ({
  ProductIntelligence: ({
    view,
  }: {
    view: { audience: string; product: { id: string }; firstRun: boolean };
  }) => (
    <div
      data-audience={view.audience}
      data-product={view.product.id}
      data-first-run={view.firstRun}
    />
  ),
}));

import ProductIntelligencePage from "./page";

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
  vi.clearAllMocks();
  mocks.navMode = "worker";
  mocks.load.mockResolvedValue({
    requestedAt: now,
    provider: { id: "org-1", name: "Harbor Salon" },
    products: [
      {
        id: "product-1",
        name: "Hair appointments",
        productLineId: "line-1",
      },
    ],
    intelligence: empty("product-intelligence"),
    scheduledPlaybooks: empty("scheduled-agent-task"),
  });
});

describe("ProductIntelligencePage", () => {
  it("uses the canonical product projection and guided disclosure", async () => {
    const html = renderToStaticMarkup(
      await ProductIntelligencePage({
        params: Promise.resolve({ id: "product-1" }),
      }),
    );

    expect(mocks.load).toHaveBeenCalledWith("product", "product-1");
    expect(html).toContain('data-product="product-1"');
    expect(html).toContain('data-audience="guided"');
    expect(html).toContain('data-first-run="true"');
  });

  it("changes disclosure density without changing the canonical scope", async () => {
    mocks.navMode = "operator";
    const html = renderToStaticMarkup(
      await ProductIntelligencePage({
        params: Promise.resolve({ id: "product-1" }),
      }),
    );

    expect(html).toContain('data-audience="professional"');
    expect(mocks.load).toHaveBeenCalledWith("product", "product-1");
  });
});
