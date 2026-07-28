/**
 * Compatibility adapter for the Phase 7 intelligence imports. The canonical
 * scope contract now lives in product-management-scope so demand, intelligence,
 * objectives, and later roadmap projections cannot drift into parallel rules.
 */

import {
  ProductManagementScopeError,
  assertProductManagementScopeExists,
  buildExactProductManagementScopeWhere,
  buildProductManagementProjectionWhere,
  cleanProductManagementScopeId,
  normalizeProductManagementScope,
  productManagementScopeLabel,
  type ProductManagementScope,
  type ProductManagementScopeClient,
  type ProductManagementScopeErrorCode,
  type ProductManagementScopeInput,
  type ProductManagementScopeKind,
} from "./product-management-scope";

export {
  ProductManagementScopeError as ProductIntelligenceScopeError,
  assertProductManagementScopeExists as assertProductIntelligenceScopeExists,
  buildExactProductManagementScopeWhere as buildExactProductIntelligenceScopeWhere,
  normalizeProductManagementScope as normalizeProductIntelligenceScope,
  productManagementScopeLabel as productIntelligenceScopeLabel,
};

export type ProductIntelligenceScopeKind = ProductManagementScopeKind;
export type ProductIntelligenceScopeInput = ProductManagementScopeInput;
export type ProductIntelligenceScope = ProductManagementScope;
export type ProductIntelligenceScopeErrorCode =
  ProductManagementScopeErrorCode;
export type ProductIntelligenceScopeClient = ProductManagementScopeClient;

export function buildProductIntelligenceVisibilityWhere(input: {
  organizationId: string;
  productLineId: string;
  businessProductId: string;
  enablingDigitalProductIds?: string[];
}) {
  const organizationId = cleanProductManagementScopeId(input.organizationId);
  const productLineId = cleanProductManagementScopeId(input.productLineId);
  const businessProductId = cleanProductManagementScopeId(
    input.businessProductId,
  );
  if (!organizationId || !productLineId || !businessProductId) {
    throw new ProductManagementScopeError(
      "organization-required",
      "Product intelligence visibility requires an organization, product line, and business product.",
    );
  }
  return buildProductManagementProjectionWhere({
    organizationId,
    productLineIds: [productLineId],
    businessProductIds: [businessProductId],
    digitalProductIds: input.enablingDigitalProductIds,
  });
}
export const buildProductIntelligenceProjectionWhere =
  buildProductManagementProjectionWhere;

function uniqueIds(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map(cleanProductManagementScopeId)
        .filter((id): id is string => Boolean(id)),
    ),
  ).sort();
}

export function buildScheduledProductIntelligenceVisibilityWhere(input: {
  organizationId: string;
  productLineIds?: string[];
  businessProductIds?: string[];
}) {
  const organizationId = cleanProductManagementScopeId(input.organizationId);
  if (!organizationId) {
    throw new ProductManagementScopeError(
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
