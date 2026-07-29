function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function isRecognizedProductSoldStatus(status: string): boolean {
  return (
    status === "purchased" ||
    status === "active" ||
    status === "fulfilled"
  );
}

/**
 * Canonical Product Sold rollup. Root sale revenue is additive; package
 * component allocations are attribution only and must never be added again.
 */
export function summarizeProductSoldRevenue(
  rows: Array<{
    productSoldId: string;
    status?: string;
    totalAmount: number;
    componentAllocations: Array<{
      catalogItemId: string;
      allocatedAmount: number;
    }>;
  }>,
) {
  const sales = [...new Map(rows.map((row) => [row.productSoldId, row])).values()];
  const recognizedSales = sales.filter(
    (sale) =>
      sale.status === undefined ||
      isRecognizedProductSoldStatus(sale.status),
  );
  const allocations = new Map<string, number>();
  for (const sale of recognizedSales) {
    for (const allocation of sale.componentAllocations) {
      allocations.set(
        allocation.catalogItemId,
        (allocations.get(allocation.catalogItemId) ?? 0) +
          allocation.allocatedAmount,
      );
    }
  }
  return {
    saleCount: recognizedSales.length,
    additiveRevenue: roundCurrency(
      recognizedSales.reduce((sum, sale) => sum + sale.totalAmount, 0),
    ),
    componentAllocations: [...allocations.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([catalogItemId, allocatedAmount]) => ({
        catalogItemId,
        allocatedAmount: roundCurrency(allocatedAmount),
        additive: false as const,
      })),
  };
}
