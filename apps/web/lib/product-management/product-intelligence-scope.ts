/**
 * Canonical scope contract for product-management intelligence.
 *
 * Business ProductLine/Product scope and EEMD DigitalProduct scope are
 * intentionally independent. One record can target at most one narrower
 * boundary; no caller may infer a business target from a digital product (or
 * vice versa), and organization-wide evidence remains a first-class case.
 */

export type ProductIntelligenceScopeKind =
  | "organization"
  | "product-line"
  | "business-product"
  | "digital-product";

export type ProductIntelligenceScopeInput = {
  organizationId: string;
  productLineId?: string | null;
  businessProductId?: string | null;
  digitalProductId?: string | null;
};

export type ProductIntelligenceScope = {
  kind: ProductIntelligenceScopeKind;
  organizationId: string;
  productLineId: string | null;
  businessProductId: string | null;
  digitalProductId: string | null;
};

export type ProductIntelligenceScopeErrorCode =
  | "organization-required"
  | "conflicting-scope"
  | "scope-not-found";

export class ProductIntelligenceScopeError extends Error {
  constructor(
    readonly code: ProductIntelligenceScopeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProductIntelligenceScopeError";
  }
}

function cleanId(value: string | null | undefined): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

export function normalizeProductIntelligenceScope(
  input: ProductIntelligenceScopeInput,
): ProductIntelligenceScope {
  const organizationId = cleanId(input.organizationId);
  if (!organizationId) {
    throw new ProductIntelligenceScopeError(
      "organization-required",
      "Product intelligence scope requires an organization.",
    );
  }

  const productLineId = cleanId(input.productLineId);
  const businessProductId = cleanId(input.businessProductId);
  const digitalProductId = cleanId(input.digitalProductId);
  const targets = [productLineId, businessProductId, digitalProductId].filter(Boolean);
  if (targets.length > 1) {
    throw new ProductIntelligenceScopeError(
      "conflicting-scope",
      "Choose one narrower intelligence scope: product line, business product, or digital product.",
    );
  }

  const kind: ProductIntelligenceScopeKind = productLineId
    ? "product-line"
    : businessProductId
      ? "business-product"
      : digitalProductId
        ? "digital-product"
        : "organization";

  return {
    kind,
    organizationId,
    productLineId,
    businessProductId,
    digitalProductId,
  };
}

export function buildExactProductIntelligenceScopeWhere(
  input: ProductIntelligenceScopeInput,
) {
  const scope = normalizeProductIntelligenceScope(input);
  return {
    organizationId: scope.organizationId,
    productLineId: scope.productLineId,
    businessProductId: scope.businessProductId,
    digitalProductId: scope.digitalProductId,
  };
}

export function buildProductIntelligenceVisibilityWhere(input: {
  organizationId: string;
  productLineId: string;
  businessProductId: string;
  enablingDigitalProductIds?: string[];
}) {
  const organizationId = cleanId(input.organizationId);
  const productLineId = cleanId(input.productLineId);
  const businessProductId = cleanId(input.businessProductId);
  if (!organizationId || !productLineId || !businessProductId) {
    throw new ProductIntelligenceScopeError(
      "organization-required",
      "Product intelligence visibility requires an organization, product line, and business product.",
    );
  }

  return buildProductIntelligenceProjectionWhere({
    organizationId,
    productLineIds: [productLineId],
    businessProductIds: [businessProductId],
    digitalProductIds: input.enablingDigitalProductIds,
  });
}

function uniqueIds(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.map(cleanId).filter((id): id is string => Boolean(id))),
  ).sort();
}

export function buildProductIntelligenceProjectionWhere(input: {
  organizationId: string;
  productLineIds?: string[];
  businessProductIds?: string[];
  digitalProductIds?: string[];
}) {
  const organizationId = cleanId(input.organizationId);
  if (!organizationId) {
    throw new ProductIntelligenceScopeError(
      "organization-required",
      "Product intelligence visibility requires an organization.",
    );
  }
  const productLineIds = uniqueIds(input.productLineIds ?? []);
  const businessProductIds = uniqueIds(input.businessProductIds ?? []);
  const digitalProductIds = uniqueIds(input.digitalProductIds ?? []);
  return {
    organizationId,
    OR: [
      {
        productLineId: null,
        businessProductId: null,
        digitalProductId: null,
      },
      ...(productLineIds.length > 0
        ? [
            {
              productLineId:
                productLineIds.length === 1
                  ? productLineIds[0]
                  : { in: productLineIds },
              businessProductId: null,
              digitalProductId: null,
            },
          ]
        : []),
      ...(businessProductIds.length > 0
        ? [
            {
              productLineId: null,
              businessProductId:
                businessProductIds.length === 1
                  ? businessProductIds[0]
                  : { in: businessProductIds },
              digitalProductId: null,
            },
          ]
        : []),
      ...(digitalProductIds.length > 0
        ? [
            {
              productLineId: null,
              businessProductId: null,
              digitalProductId: { in: digitalProductIds },
            },
          ]
        : []),
    ],
  };
}

export function buildScheduledProductIntelligenceVisibilityWhere(input: {
  organizationId: string;
  productLineIds?: string[];
  businessProductIds?: string[];
}) {
  const organizationId = cleanId(input.organizationId);
  if (!organizationId) {
    throw new ProductIntelligenceScopeError(
      "organization-required",
      "Scheduled product intelligence visibility requires an organization.",
    );
  }
  const productLineIds = uniqueIds(input.productLineIds ?? []);
  const businessProductIds = uniqueIds(input.businessProductIds ?? []);
  return {
    organizationId,
    OR: [
      { productLineId: null, businessProductId: null },
      ...(productLineIds.length > 0
        ? [
            {
              productLineId:
                productLineIds.length === 1
                  ? productLineIds[0]
                  : { in: productLineIds },
              businessProductId: null,
            },
          ]
        : []),
      ...(businessProductIds.length > 0
        ? [
            {
              productLineId: null,
              businessProductId:
                businessProductIds.length === 1
                  ? businessProductIds[0]
                  : { in: businessProductIds },
            },
          ]
        : []),
    ],
  };
}

export type ProductIntelligenceScopeClient = {
  organization: {
    findFirst: (args: unknown) => Promise<unknown>;
  };
  productLine: {
    findFirst: (args: unknown) => Promise<unknown>;
  };
  product: {
    findFirst: (args: unknown) => Promise<unknown>;
  };
  digitalProduct: {
    findFirst: (args: unknown) => Promise<unknown>;
  };
};

export async function assertProductIntelligenceScopeExists(
  scope: ProductIntelligenceScope,
  db: ProductIntelligenceScopeClient,
): Promise<void> {
  const organization = await db.organization.findFirst({
    where: { id: scope.organizationId },
    select: { id: true },
  });
  if (!organization) {
    throw new ProductIntelligenceScopeError(
      "scope-not-found",
      "The organization for this intelligence scope was not found.",
    );
  }

  const target =
    scope.kind === "product-line"
      ? await db.productLine.findFirst({
          where: {
            id: scope.productLineId,
            organizationId: scope.organizationId,
            effectiveTo: null,
          },
          select: { id: true },
        })
      : scope.kind === "business-product"
        ? await db.product.findFirst({
            where: {
              id: scope.businessProductId,
              organizationId: scope.organizationId,
              effectiveTo: null,
            },
            select: { id: true },
          })
        : scope.kind === "digital-product"
          ? await db.digitalProduct.findFirst({
              where: {
                id: scope.digitalProductId,
                organizationId: scope.organizationId,
              },
              select: { id: true },
            })
          : organization;

  if (!target) {
    throw new ProductIntelligenceScopeError(
      "scope-not-found",
      `The ${scope.kind} target is not available in this organization.`,
    );
  }
}

export function productIntelligenceScopeLabel(scope: ProductIntelligenceScope): string {
  switch (scope.kind) {
    case "product-line":
      return "Product line";
    case "business-product":
      return "Product";
    case "digital-product":
      return "Digital architecture";
    default:
      return "Whole business";
  }
}
