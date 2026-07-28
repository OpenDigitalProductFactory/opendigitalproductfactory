/**
 * Canonical organization/product-line/business-product/digital-product scope.
 *
 * Business product management and EEMD digital-product architecture remain
 * distinct. A scoped record names the organization and at most one narrower
 * target; callers may not infer one target kind from another.
 */

export type ProductManagementScopeKind =
  | "organization"
  | "product-line"
  | "business-product"
  | "digital-product";

export type ProductManagementScopeInput = {
  organizationId: string;
  productLineId?: string | null;
  businessProductId?: string | null;
  digitalProductId?: string | null;
};

export type ProductManagementScope = {
  kind: ProductManagementScopeKind;
  organizationId: string;
  productLineId: string | null;
  businessProductId: string | null;
  digitalProductId: string | null;
};

export type ProductManagementScopeErrorCode =
  | "organization-required"
  | "conflicting-scope"
  | "scope-not-found";

export class ProductManagementScopeError extends Error {
  constructor(
    readonly code: ProductManagementScopeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProductManagementScopeError";
  }
}

export function cleanProductManagementScopeId(
  value: string | null | undefined,
): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

export function normalizeProductManagementScope(
  input: ProductManagementScopeInput,
): ProductManagementScope {
  const organizationId = cleanProductManagementScopeId(input.organizationId);
  if (!organizationId) {
    throw new ProductManagementScopeError(
      "organization-required",
      "Product-management scope requires an organization.",
    );
  }

  const productLineId = cleanProductManagementScopeId(input.productLineId);
  const businessProductId = cleanProductManagementScopeId(
    input.businessProductId,
  );
  const digitalProductId = cleanProductManagementScopeId(
    input.digitalProductId,
  );
  const targets = [productLineId, businessProductId, digitalProductId].filter(
    Boolean,
  );
  if (targets.length > 1) {
    throw new ProductManagementScopeError(
      "conflicting-scope",
      "Choose one narrower scope: product line, business product, or digital product.",
    );
  }

  return {
    kind: productLineId
      ? "product-line"
      : businessProductId
        ? "business-product"
        : digitalProductId
          ? "digital-product"
          : "organization",
    organizationId,
    productLineId,
    businessProductId,
    digitalProductId,
  };
}

export function buildExactProductManagementScopeWhere(
  input: ProductManagementScopeInput,
) {
  const scope = normalizeProductManagementScope(input);
  return {
    organizationId: scope.organizationId,
    productLineId: scope.productLineId,
    businessProductId: scope.businessProductId,
    digitalProductId: scope.digitalProductId,
  };
}

function uniqueIds(
  values: Array<string | null | undefined>,
): string[] {
  return Array.from(
    new Set(
      values
        .map(cleanProductManagementScopeId)
        .filter((id): id is string => Boolean(id)),
    ),
  ).sort();
}

export function buildProductManagementProjectionWhere(input: {
  organizationId: string;
  productLineIds?: string[];
  businessProductIds?: string[];
  digitalProductIds?: string[];
}) {
  const organizationId = cleanProductManagementScopeId(input.organizationId);
  if (!organizationId) {
    throw new ProductManagementScopeError(
      "organization-required",
      "Product-management visibility requires an organization.",
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
              digitalProductId:
                digitalProductIds.length === 1
                  ? digitalProductIds[0]
                  : { in: digitalProductIds },
            },
          ]
        : []),
    ],
  };
}

export type ProductManagementScopeClient = {
  organization: { findFirst: (args: unknown) => Promise<{ id: string } | null> };
  productLine: {
    findFirst: (
      args: unknown,
    ) => Promise<{ id: string; organizationId?: string } | null>;
  };
  product: {
    findFirst: (
      args: unknown,
    ) => Promise<{ id: string; organizationId?: string } | null>;
  };
  digitalProduct: { findFirst: (args: unknown) => Promise<{ id: string } | null> };
};

export type ProductManagementScopeRefs = {
  organizationRef: string;
  productLineRef?: string | null;
  businessProductRef?: string | null;
  digitalProductRef?: string | null;
};

/**
 * Resolve stable public refs at the canonical boundary. Callers persist internal
 * foreign keys, but never ask a person or coworker to discover a Prisma cuid.
 */
export async function resolveProductManagementScopeRefs(
  input: ProductManagementScopeRefs,
  db: ProductManagementScopeClient,
): Promise<ProductManagementScope> {
  const organizationRef = cleanProductManagementScopeId(input.organizationRef);
  if (!organizationRef) {
    throw new ProductManagementScopeError(
      "organization-required",
      "Product-management scope requires an organization.",
    );
  }
  const rawTargets = [
    cleanProductManagementScopeId(input.productLineRef),
    cleanProductManagementScopeId(input.businessProductRef),
    cleanProductManagementScopeId(input.digitalProductRef),
  ].filter(Boolean);
  if (rawTargets.length > 1) {
    throw new ProductManagementScopeError(
      "conflicting-scope",
      "Choose one narrower scope: product line, business product, or digital product.",
    );
  }

  const organization = await db.organization.findFirst({
    where: {
      OR: [
        { id: organizationRef },
        { orgId: organizationRef },
        { slug: organizationRef },
      ],
    },
    select: { id: true },
  });
  if (!organization) {
    throw new ProductManagementScopeError(
      "scope-not-found",
      `Organization ${organizationRef} was not found.`,
    );
  }

  const productLineRef = cleanProductManagementScopeId(input.productLineRef);
  const businessProductRef = cleanProductManagementScopeId(
    input.businessProductRef,
  );
  const digitalProductRef = cleanProductManagementScopeId(
    input.digitalProductRef,
  );
  const productLine = productLineRef
    ? await db.productLine.findFirst({
        where: {
          organizationId: organization.id,
          effectiveTo: null,
          OR: [
            { id: productLineRef },
            { lineId: productLineRef },
            { key: productLineRef },
          ],
        },
        select: { id: true, organizationId: true },
      })
    : null;
  const businessProduct = businessProductRef
    ? await db.product.findFirst({
        where: {
          organizationId: organization.id,
          effectiveTo: null,
          OR: [
            { id: businessProductRef },
            { productId: businessProductRef },
            { key: businessProductRef },
          ],
        },
        select: { id: true, organizationId: true },
      })
    : null;
  const digitalProduct = digitalProductRef
    ? await db.digitalProduct.findFirst({
        where: {
          OR: [{ id: digitalProductRef }, { productId: digitalProductRef }],
        },
        select: { id: true },
      })
    : null;
  if (
    (productLineRef && !productLine) ||
    (businessProductRef && !businessProduct) ||
    (digitalProductRef && !digitalProduct)
  ) {
    throw new ProductManagementScopeError(
      "scope-not-found",
      "The requested product-management target was not found.",
    );
  }

  return normalizeProductManagementScope({
    organizationId: organization.id,
    productLineId: productLine?.id,
    businessProductId: businessProduct?.id,
    digitalProductId: digitalProduct?.id,
  });
}

export async function assertProductManagementScopeExists(
  scope: ProductManagementScope,
  db: ProductManagementScopeClient,
): Promise<void> {
  const organization = await db.organization.findFirst({
    where: { id: scope.organizationId },
    select: { id: true },
  });
  if (!organization) {
    throw new ProductManagementScopeError(
      "scope-not-found",
      "The organization for this product-management scope was not found.",
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
              },
              select: { id: true },
            })
          : organization;

  if (!target) {
    throw new ProductManagementScopeError(
      "scope-not-found",
      `The ${scope.kind} target is not available in this organization.`,
    );
  }
}

export function productManagementScopeLabel(
  scope: ProductManagementScope,
): string {
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
