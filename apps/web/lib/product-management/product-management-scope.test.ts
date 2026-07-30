import { describe, expect, it } from "vitest";

import {
  buildExactProductManagementScopeWhere,
  buildProductManagementProjectionWhere,
  normalizeProductManagementScope,
  resolveProductManagementScopeRefs,
} from "./product-management-scope";

describe("product-management scope", () => {
  it("keeps business and digital product targets distinct", () => {
    expect(
      normalizeProductManagementScope({
        organizationId: "org-1",
        businessProductId: "business-1",
      }),
    ).toEqual({
      kind: "business-product",
      organizationId: "org-1",
      productLineId: null,
      businessProductId: "business-1",
      digitalProductId: null,
    });
    expect(
      normalizeProductManagementScope({
        organizationId: "org-1",
        digitalProductId: "digital-1",
      }),
    ).toMatchObject({
      kind: "digital-product",
      businessProductId: null,
      digitalProductId: "digital-1",
    });
  });

  it("resolves stable public refs without crossing business and digital authorities", async () => {
    const db = {
      organization: {
        findFirst: async () => ({ id: "org-internal" }),
      },
      productLine: {
        findFirst: async () => ({ id: "line-internal", organizationId: "org-internal" }),
      },
      product: {
        findFirst: async () => null,
      },
      digitalProduct: {
        findFirst: async () => null,
      },
    };

    await expect(
      resolveProductManagementScopeRefs(
        {
          organizationRef: "ORG-DEMO",
          productLineRef: "PL-SERVICES",
        },
        db,
      ),
    ).resolves.toEqual({
      kind: "product-line",
      organizationId: "org-internal",
      productLineId: "line-internal",
      businessProductId: null,
      digitalProductId: null,
    });
  });

  it("rejects fabricated multi-target scope", () => {
    expect(() =>
      normalizeProductManagementScope({
        organizationId: "org-1",
        businessProductId: "business-1",
        digitalProductId: "digital-1",
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "conflicting-scope",
      }),
    );
  });

  it("builds exact and projection query boundaries", () => {
    expect(
      buildExactProductManagementScopeWhere({
        organizationId: "org-1",
        productLineId: "line-1",
      }),
    ).toEqual({
      organizationId: "org-1",
      productLineId: "line-1",
      businessProductId: null,
      digitalProductId: null,
    });
    expect(
      buildProductManagementProjectionWhere({
        organizationId: "org-1",
        businessProductIds: ["product-1"],
        digitalProductIds: ["digital-1"],
      }),
    ).toEqual({
      organizationId: "org-1",
      OR: [
        {
          productLineId: null,
          businessProductId: null,
          digitalProductId: null,
        },
        {
          productLineId: null,
          businessProductId: "product-1",
          digitalProductId: null,
        },
        {
          productLineId: null,
          businessProductId: null,
          digitalProductId: "digital-1",
        },
      ],
    });
  });
});
