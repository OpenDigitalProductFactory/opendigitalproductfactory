import { describe, expect, it } from "vitest";

import {
  PRODUCTS_AND_SERVICES_SOLD,
  buildProductHierarchyPlan,
  validateProductLineGraph,
} from "./product-hierarchy";

describe("business product hierarchy", () => {
  it("preserves the canonical Goods and Services for Sale portfolio identity", () => {
    expect(PRODUCTS_AND_SERVICES_SOLD).toEqual({
      slug: "products_and_services_sold",
      label: "Goods and Services for Sale",
    });
  });

  it("defaults the organization as provider and never invents consumers", () => {
    const result = buildProductHierarchyPlan({
      organizationId: "org-simple",
      lines: [
        {
          key: "services",
          label: "Services",
          products: [{ key: "consulting", label: "Consulting" }],
        },
      ],
    });

    expect(result.provider).toEqual({ organizationId: "org-simple" });
    expect(result.consumers).toEqual([]);
    expect(result.lines[0]).toMatchObject({
      lineId: "PL-org-simple-services",
      key: "services",
      name: "Services",
    });
    expect(result.lines[0].products[0]).toMatchObject({
      productId: "PR-org-simple-services-consulting",
      key: "consulting",
      name: "Consulting",
    });
    expect(JSON.stringify(result)).not.toMatch(
      /team|businessUnit|subscriber|entitlement/i,
    );
  });

  it("produces stable identities across rename and replay", () => {
    const before = buildProductHierarchyPlan({
      organizationId: "org-1",
      lines: [{ key: "events", label: "Events", products: [] }],
    });
    const after = buildProductHierarchyPlan({
      organizationId: "org-1",
      lines: [{ key: "events", label: "Private events", products: [] }],
    });

    expect(after.lines[0].lineId).toBe(before.lines[0].lineId);
    expect(after.lines[0].name).toBe("Private events");
  });

  it("supports nested rollups inside one organization", () => {
    const result = buildProductHierarchyPlan({
      organizationId: "org-hotel",
      lines: [
        { key: "hospitality", label: "Hospitality", products: [] },
        {
          key: "rooms",
          label: "Rooms",
          parentKey: "hospitality",
          products: [{ key: "overnight-stays", label: "Overnight stays" }],
        },
      ],
    });

    expect(result.lines[1].parentLineId).toBe("PL-org-hotel-hospitality");
  });

  it("rejects self-parenting, missing parents, duplicate keys, and cycles", () => {
    expect(() =>
      validateProductLineGraph([
        { key: "a", label: "A", parentKey: "a", products: [] },
      ]),
    ).toThrow("itself");

    expect(() =>
      validateProductLineGraph([
        { key: "a", label: "A", parentKey: "missing", products: [] },
      ]),
    ).toThrow("parent");

    expect(() =>
      validateProductLineGraph([
        { key: "a", label: "A", products: [] },
        { key: "a", label: "Again", products: [] },
      ]),
    ).toThrow("unique");

    expect(() =>
      validateProductLineGraph([
        { key: "a", label: "A", parentKey: "b", products: [] },
        { key: "b", label: "B", parentKey: "a", products: [] },
      ]),
    ).toThrow("cycle");
  });
});
