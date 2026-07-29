import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CatalogBuilderPanel, type CatalogBuilderView } from "./CatalogBuilderPanel";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const simple: CatalogBuilderView = {
  storefrontItemId: "storefront-row",
  catalogItemRowId: "catalog-row",
  catalogItemId: "CAT-HAIRCUT",
  name: "Haircut",
  fulfillmentRoute: "booking",
  bundleComponents: [],
  candidateItems: [{ id: "shave-row", catalogItemId: "CAT-SHAVE", name: "Shave" }],
  priceEntries: [],
  promotions: [],
  configurations: [],
  channels: [],
};

describe("Catalog Builder progressive owner UX", () => {
  it("leads with the working simple path and business language", () => {
    const html = renderToStaticMarkup(<CatalogBuilderPanel initial={simple} />);
    expect(html).toContain("Your ordinary price already works");
    expect(html).toContain("How customers get it");
    expect(html).toContain("Package contents");
    expect(html).toContain("Customer purchases and use");
    expect(html).toContain(
      "/storefront/items/storefront-row/purchases",
    );
    expect(html).not.toContain("ProductOffering");
    expect(html).not.toContain("CatalogItem");
    expect(html).not.toContain("DigitalProduct");
  });

  it("explains that promotions and one-off choices do not grow product/SKU authorities implicitly", () => {
    const html = renderToStaticMarkup(<CatalogBuilderPanel initial={simple} />);
    expect(html).toContain("Add one without creating another product");
    expect(html).toContain("One-off choices stay with their quote or order");
    expect(html).toContain("Publish a reusable standard option");
  });

  it("uses semantic tokens and 44px controls without hardcoded colors", () => {
    const html = renderToStaticMarkup(<CatalogBuilderPanel initial={simple} />);
    expect(html).toContain("min-h-[44px]");
    expect(html).toContain("var(--dpf-accent)");
    expect(html).not.toMatch(/#[0-9a-f]{3,8}/i);
  });

  it("keeps enterprise packaging controls behind one owner-readable disclosure", () => {
    const html = renderToStaticMarkup(<CatalogBuilderPanel initial={simple} />);
    expect(html).toContain("Advanced packaging and sales options");
    expect(html.indexOf("How customers get it")).toBeLessThan(
      html.indexOf("Advanced packaging and sales options"),
    );
    expect(html).toContain("Add with equal attribution");
    expect(html).not.toContain("Revenue attribution (%)");
  });
});
