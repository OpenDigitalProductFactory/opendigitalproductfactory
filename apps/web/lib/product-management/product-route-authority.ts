export type BusinessProductRouteRecord = {
  id: string;
  productId: string;
  name: string;
  description: string | null;
  productLine: {
    id: string;
    lineId: string;
    name: string;
  };
  organization: {
    id: string;
    name: string;
  };
};

export type DigitalProductRouteRecord = {
  id: string;
  productId: string;
  name: string;
  description: string | null;
  lifecycleStage: string;
  lifecycleStatus: string;
  version: string;
  portfolio: { name: string; slug: string } | null;
  taxonomyNode: { name: string; nodeId: string } | null;
};

export type ProductRouteAuthority =
  | { kind: "business-product"; product: BusinessProductRouteRecord }
  | { kind: "digital-product"; product: DigitalProductRouteRecord };

export type ProductRouteAuthorityDb = {
  product: {
    findFirst(args: object): Promise<BusinessProductRouteRecord | null>;
  };
  digitalProduct: {
    findUnique(args: object): Promise<DigitalProductRouteRecord | null>;
  };
};

export class ProductRouteAuthorityAmbiguousError extends Error {
  constructor() {
    super("The product route identifier does not resolve to one authority.");
    this.name = "ProductRouteAuthorityAmbiguousError";
  }
}

/**
 * Compatibility boundary for the historic product URL.
 *
 * Business Product and DigitalProduct are separate authorities. Both are
 * queried explicitly; neither is inferred from an offering or from the other.
 * A dual match is treated as ambiguous and fails closed.
 */
export async function resolveProductRouteAuthority(input: {
  db: ProductRouteAuthorityDb;
  id: string;
  organizationId: string;
}): Promise<ProductRouteAuthority | null> {
  const [businessProduct, digitalProduct] = await Promise.all([
    input.db.product.findFirst({
      where: {
        id: input.id,
        organizationId: input.organizationId,
        effectiveTo: null,
      },
      select: {
        id: true,
        productId: true,
        name: true,
        description: true,
        productLine: {
          select: {
            id: true,
            lineId: true,
            name: true,
          },
        },
        organization: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    }),
    input.db.digitalProduct.findUnique({
      where: { id: input.id },
      select: {
        id: true,
        productId: true,
        name: true,
        description: true,
        lifecycleStage: true,
        lifecycleStatus: true,
        version: true,
        portfolio: { select: { name: true, slug: true } },
        taxonomyNode: { select: { name: true, nodeId: true } },
      },
    }),
  ]);

  if (businessProduct && digitalProduct) {
    throw new ProductRouteAuthorityAmbiguousError();
  }
  if (businessProduct) {
    return { kind: "business-product", product: businessProduct };
  }
  if (digitalProduct) {
    return { kind: "digital-product", product: digitalProduct };
  }
  return null;
}
