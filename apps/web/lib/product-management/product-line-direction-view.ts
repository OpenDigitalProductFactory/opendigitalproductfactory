import type { ProductOperatingContext } from "./product-operating-context";

export type ProductLinePortfolioNode = {
  id: string;
  name: string;
  parentId: string | null;
  directProductCount: number;
  totalProductCount: number;
  saleCount: number;
  additiveRevenue: number;
  currency: string | null;
  children: ProductLinePortfolioNode[];
};

export type ProductLineComparisonRow = {
  productId: string;
  semanticId: string;
  name: string;
  saleCount: number;
  additiveRevenue: number;
  currency: string | null;
  unallocatedComponentCount: number;
  href: string;
};

export function buildProductLineComparison(
  context: ProductOperatingContext,
): ProductLineComparisonRow[] {
  const performance = new Map(
    context.commercialPerformanceByProduct.map((row) => [
      row.productId,
      row,
    ]),
  );
  return context.products.map((product) => {
    const measures = performance.get(product.id);
    return {
      productId: product.id,
      semanticId: product.productId,
      name: product.name,
      saleCount: measures?.saleCount ?? 0,
      additiveRevenue: measures?.additiveRevenue ?? 0,
      currency: measures?.currency ?? null,
      unallocatedComponentCount:
        measures?.unallocatedComponentCount ?? 0,
      href: `/portfolio/product/${product.id}/direction`,
    };
  });
}

export function buildProductPortfolioHierarchy(
  context: ProductOperatingContext,
): ProductLinePortfolioNode[] {
  const linesById = new Map(
    context.productLines.map((line) => [line.id, line]),
  );
  const childrenByParent = new Map<string, string[]>();
  for (const line of context.productLines) {
    if (!line.parentId || !linesById.has(line.parentId)) continue;
    const children = childrenByParent.get(line.parentId) ?? [];
    children.push(line.id);
    childrenByParent.set(line.parentId, children);
  }
  for (const children of childrenByParent.values()) children.sort();

  const productsByLine = new Map<string, string[]>();
  for (const product of context.products) {
    const products = productsByLine.get(product.productLineId) ?? [];
    products.push(product.id);
    productsByLine.set(product.productLineId, products);
  }
  const performance = new Map(
    context.commercialPerformanceByProduct.map((row) => [
      row.productId,
      row,
    ]),
  );
  const emitted = new Set<string>();

  function renderNode(
    id: string,
    ancestry: ReadonlySet<string>,
  ): ProductLinePortfolioNode | null {
    if (emitted.has(id) || ancestry.has(id)) return null;
    const line = linesById.get(id);
    if (!line) return null;
    emitted.add(id);
    const nextAncestry = new Set(ancestry);
    nextAncestry.add(id);
    const children = (childrenByParent.get(id) ?? []).flatMap((childId) => {
      const child = renderNode(childId, nextAncestry);
      return child ? [child] : [];
    });
    const directProductIds = productsByLine.get(id) ?? [];
    const descendantProductCount = children.reduce(
      (sum, child) => sum + child.totalProductCount,
      0,
    );
    const directMeasures = directProductIds.flatMap((productId) => {
      const row = performance.get(productId);
      return row ? [row] : [];
    });
    const currencies = new Set([
      ...directMeasures.flatMap((row) => (row.currency ? [row.currency] : [])),
      ...children.flatMap((child) => (child.currency ? [child.currency] : [])),
    ]);
    const hasUnknownCurrency =
      directMeasures.some(
        (row) => row.saleCount > 0 && row.currency === null,
      ) ||
      children.some(
        (child) => child.saleCount > 0 && child.currency === null,
      );
    return {
      id,
      name: line.name,
      parentId: line.parentId,
      directProductCount: directProductIds.length,
      totalProductCount: directProductIds.length + descendantProductCount,
      saleCount:
        directMeasures.reduce((sum, row) => sum + row.saleCount, 0) +
        children.reduce((sum, child) => sum + child.saleCount, 0),
      additiveRevenue:
        directMeasures.reduce(
          (sum, row) => sum + row.additiveRevenue,
          0,
        ) +
        children.reduce(
          (sum, child) => sum + child.additiveRevenue,
          0,
        ),
      currency:
        !hasUnknownCurrency && currencies.size === 1
          ? [...currencies][0]!
          : null,
      children,
    };
  }

  const roots = context.productLines
    .filter(
      (line) => !line.parentId || !linesById.has(line.parentId),
    )
    .map((line) => line.id);
  const result = roots.flatMap((id) => {
    const node = renderNode(id, new Set());
    return node ? [node] : [];
  });

  for (const id of [...linesById.keys()].sort()) {
    if (emitted.has(id)) continue;
    const node = renderNode(id, new Set());
    if (node) result.push(node);
  }
  return result;
}
