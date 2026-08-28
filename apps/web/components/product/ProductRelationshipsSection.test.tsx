import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProductRelationshipsSection } from "./ProductRelationshipsSection";

describe("ProductRelationshipsSection", () => {
  it("renders incoming and outgoing dependencies independently from estate and SBOM state", () => {
    const html = renderToStaticMarkup(
      <ProductRelationshipsSection
        productId="product-1"
        relationships={[
          {
            id: "dep-1",
            relationType: "depends_on",
            source: "portfolio",
            fromProduct: { id: "product-1", name: "Portal" },
            toProduct: { id: "product-2", name: "PostgreSQL" },
          },
          {
            id: "dep-2",
            relationType: "part_of",
            source: null,
            fromProduct: { id: "product-3", name: "Customer experience" },
            toProduct: { id: "product-1", name: "Portal" },
          },
        ]}
      />,
    );

    expect(html).toContain("Depends on");
    expect(html).toContain("PostgreSQL");
    expect(html).toContain("Depended on by");
    expect(html).toContain("Customer experience");
  });

  it("renders its own empty state", () => {
    const html = renderToStaticMarkup(
      <ProductRelationshipsSection productId="product-1" relationships={[]} />,
    );

    expect(html).toContain("No product relationships recorded yet");
  });
});
