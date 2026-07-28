import { describe, expect, it, vi } from "vitest";
import {
  ProductIntelligenceScopeError,
  assertProductIntelligenceScopeExists,
  buildExactProductIntelligenceScopeWhere,
  buildProductIntelligenceVisibilityWhere,
  buildProductIntelligenceProjectionWhere,
  buildScheduledProductIntelligenceVisibilityWhere,
  normalizeProductIntelligenceScope,
} from "./product-intelligence-scope";

describe("normalizeProductIntelligenceScope", () => {
  it("preserves an explicit organization-wide scope", () => {
    expect(
      normalizeProductIntelligenceScope({
        organizationId: "org-1",
      }),
    ).toEqual({
      kind: "organization",
      organizationId: "org-1",
      productLineId: null,
      businessProductId: null,
      digitalProductId: null,
    });
  });

  it.each([
    ["product-line", { productLineId: "line-1" }],
    ["business-product", { businessProductId: "product-1" }],
    ["digital-product", { digitalProductId: "digital-1" }],
  ] as const)("normalizes one explicit %s target", (kind, target) => {
    expect(
      normalizeProductIntelligenceScope({
        organizationId: "org-1",
        ...target,
      }),
    ).toMatchObject({ kind, organizationId: "org-1", ...target });
  });

  it("fails closed when more than one narrower target is supplied", () => {
    expect(() =>
      normalizeProductIntelligenceScope({
        organizationId: "org-1",
        productLineId: "line-1",
        businessProductId: "product-1",
      }),
    ).toThrowError(
      expect.objectContaining<ProductIntelligenceScopeError>({
        code: "conflicting-scope",
      }),
    );
  });

  it("requires an organization for every scope", () => {
    expect(() =>
      normalizeProductIntelligenceScope({
        organizationId: " ",
        businessProductId: "product-1",
      }),
    ).toThrowError(
      expect.objectContaining<ProductIntelligenceScopeError>({
        code: "organization-required",
      }),
    );
  });

  it("builds bounded multi-product visibility without duplicating identifiers", () => {
    expect(
      buildProductIntelligenceProjectionWhere({
        organizationId: "org-1",
        productLineIds: ["line-2", "line-1", "line-1"],
        businessProductIds: ["product-2", "product-1"],
        digitalProductIds: [],
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
          productLineId: { in: ["line-1", "line-2"] },
          businessProductId: null,
          digitalProductId: null,
        },
        {
          productLineId: null,
          businessProductId: { in: ["product-1", "product-2"] },
          digitalProductId: null,
        },
      ],
    });
  });

  it("builds scheduler visibility without inventing a digital scope column", () => {
    expect(
      buildScheduledProductIntelligenceVisibilityWhere({
        organizationId: "org-1",
        productLineIds: ["line-1"],
        businessProductIds: ["product-1"],
      }),
    ).toEqual({
      organizationId: "org-1",
      OR: [
        { productLineId: null, businessProductId: null },
        { productLineId: { in: ["line-1"] }, businessProductId: null },
        { productLineId: null, businessProductId: { in: ["product-1"] } },
      ],
    });
  });
});

describe("product intelligence scope query boundaries", () => {
  it("builds an exact organization-wide filter without inferring narrower scope", () => {
    expect(
      buildExactProductIntelligenceScopeWhere({
        organizationId: "org-1",
      }),
    ).toEqual({
      organizationId: "org-1",
      productLineId: null,
      businessProductId: null,
      digitalProductId: null,
    });
  });

  it("builds product visibility from explicit organization, line, product, and enabling-digital evidence", () => {
    expect(
      buildProductIntelligenceVisibilityWhere({
        organizationId: "org-1",
        productLineId: "line-1",
        businessProductId: "product-1",
        enablingDigitalProductIds: ["digital-2", "digital-1", "digital-1"],
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
          productLineId: "line-1",
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
          digitalProductId: { in: ["digital-1", "digital-2"] },
        },
      ],
    });
  });
});

describe("assertProductIntelligenceScopeExists", () => {
  it("accepts organization-wide scope without fabricating another target", async () => {
    const db = {
      organization: { findFirst: vi.fn(async () => ({ id: "org-1" })) },
      productLine: { findFirst: vi.fn() },
      product: { findFirst: vi.fn() },
      digitalProduct: { findFirst: vi.fn() },
    };

    await expect(
      assertProductIntelligenceScopeExists(
        normalizeProductIntelligenceScope({ organizationId: "org-1" }),
        db,
      ),
    ).resolves.toBeUndefined();
    expect(db.productLine.findFirst).not.toHaveBeenCalled();
    expect(db.product.findFirst).not.toHaveBeenCalled();
    expect(db.digitalProduct.findFirst).not.toHaveBeenCalled();
  });

  it("fails closed when a business product does not belong to the organization", async () => {
    const db = {
      organization: { findFirst: vi.fn(async () => ({ id: "org-1" })) },
      productLine: { findFirst: vi.fn() },
      product: { findFirst: vi.fn(async () => null) },
      digitalProduct: { findFirst: vi.fn() },
    };

    await expect(
      assertProductIntelligenceScopeExists(
        normalizeProductIntelligenceScope({
          organizationId: "org-1",
          businessProductId: "product-other-org",
        }),
        db,
      ),
    ).rejects.toMatchObject({
      code: "scope-not-found",
    });
    expect(db.product.findFirst).toHaveBeenCalledWith({
      where: {
        id: "product-other-org",
        organizationId: "org-1",
        effectiveTo: null,
      },
      select: { id: true },
    });
  });

  it("keeps DigitalProduct validation on the digital architecture authority", async () => {
    const db = {
      organization: { findFirst: vi.fn(async () => ({ id: "org-1" })) },
      productLine: { findFirst: vi.fn() },
      product: { findFirst: vi.fn() },
      digitalProduct: { findFirst: vi.fn(async () => ({ id: "digital-1" })) },
    };

    await expect(
      assertProductIntelligenceScopeExists(
        normalizeProductIntelligenceScope({
          organizationId: "org-1",
          digitalProductId: "digital-1",
        }),
        db,
      ),
    ).resolves.toBeUndefined();
    expect(db.digitalProduct.findFirst).toHaveBeenCalledWith({
      where: { id: "digital-1" },
      select: { id: true },
    });
  });
});
