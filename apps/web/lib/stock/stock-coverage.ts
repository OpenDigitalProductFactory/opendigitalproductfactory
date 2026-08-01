// Stock coverage — how close a stocked supply is to running out, given what
// actually sold (BI-SPEND-003 first slice).
//
// Pure and dependency-free so the arithmetic is testable without a database and
// reusable by a tool, a page, or a scheduled review. Consumption is DERIVED from
// sales rather than read from a decrement ledger: multiply each sold item by its
// recipe line. That keeps a starter free of partial-fulfilment and reversal
// semantics while still answering the operator's real question.

/** One recipe line: selling one unit of `storefrontItemId` consumes this much. */
export type ComponentLine = {
  storefrontItemId: string;
  stockItemId: string;
  quantityPerUnit: number;
};

/** A stocked supply as the operator maintains it. */
export type StockLevel = {
  stockItemId: string;
  name: string;
  unit: string;
  onHandQuantity: number;
  reorderPoint: number;
  reorderQuantity: number;
  supplierName?: string | null;
};

/** Units of a sellable item sold within the observed window. */
export type SoldUnits = {
  storefrontItemId: string;
  units: number;
};

export type StockCoverageRow = {
  stockItemId: string;
  name: string;
  unit: string;
  onHandQuantity: number;
  reorderPoint: number;
  /** Total consumed across the window, derived from sales × recipe. */
  consumedInWindow: number;
  /** Average consumption per day across the window. */
  dailyConsumption: number;
  /**
   * Days of stock remaining at the observed rate. `null` when nothing consumed
   * in the window — no rate means no honest projection, which is different from
   * "infinite cover" and must not be rendered as a comfortable number.
   */
  daysOfCover: number | null;
  /** True when on-hand has reached or fallen below the reorder point. */
  belowReorderPoint: boolean;
  /** What to order now: the configured reorder quantity, or enough to clear the
   *  reorder point when no reorder quantity was configured. */
  suggestedOrderQuantity: number;
  supplierName: string | null;
};

function round(value: number, dp = 2): number {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

/**
 * Compute coverage per stock item. `windowDays` must be > 0; sales outside the
 * window are the caller's to exclude. Items with no recipe line simply show zero
 * consumption and a null projection.
 */
export function computeStockCoverage(input: {
  stock: StockLevel[];
  components: ComponentLine[];
  sold: SoldUnits[];
  windowDays: number;
}): StockCoverageRow[] {
  const windowDays = input.windowDays > 0 ? input.windowDays : 1;
  const unitsByItem = new Map<string, number>();
  for (const s of input.sold) {
    if (!Number.isFinite(s.units) || s.units <= 0) continue;
    unitsByItem.set(s.storefrontItemId, (unitsByItem.get(s.storefrontItemId) ?? 0) + s.units);
  }

  const consumedByStock = new Map<string, number>();
  for (const line of input.components) {
    const units = unitsByItem.get(line.storefrontItemId);
    if (!units || !Number.isFinite(line.quantityPerUnit) || line.quantityPerUnit <= 0) continue;
    consumedByStock.set(
      line.stockItemId,
      (consumedByStock.get(line.stockItemId) ?? 0) + units * line.quantityPerUnit,
    );
  }

  return input.stock
    .map((item) => {
      const consumed = consumedByStock.get(item.stockItemId) ?? 0;
      const daily = consumed / windowDays;
      const daysOfCover = daily > 0 ? round(item.onHandQuantity / daily, 1) : null;
      const belowReorderPoint = item.onHandQuantity <= item.reorderPoint;
      const shortfall = Math.max(0, item.reorderPoint - item.onHandQuantity);
      const suggested = belowReorderPoint
        ? item.reorderQuantity > 0
          ? item.reorderQuantity
          : round(shortfall)
        : 0;
      return {
        stockItemId: item.stockItemId,
        name: item.name,
        unit: item.unit,
        onHandQuantity: round(item.onHandQuantity),
        reorderPoint: round(item.reorderPoint),
        consumedInWindow: round(consumed),
        dailyConsumption: round(daily),
        daysOfCover,
        belowReorderPoint,
        suggestedOrderQuantity: round(suggested),
        supplierName: item.supplierName ?? null,
      };
    })
    .sort((a, b) => {
      // Most urgent first: below-reorder items, then the shortest honest cover.
      if (a.belowReorderPoint !== b.belowReorderPoint) return a.belowReorderPoint ? -1 : 1;
      const aCover = a.daysOfCover ?? Number.POSITIVE_INFINITY;
      const bCover = b.daysOfCover ?? Number.POSITIVE_INFINITY;
      if (aCover !== bCover) return aCover - bCover;
      return a.name.localeCompare(b.name);
    });
}

/** One-line operator summary of a coverage row, e.g.
 *  "Mozzarella: 8 kg on hand, 2.2 kg/day, 3.6 days of cover — below reorder
 *   point, order 10 kg from Greenfield Logistics". Pure. */
export function describeCoverageRow(row: StockCoverageRow): string {
  const cover =
    row.daysOfCover === null
      ? "no usage in this window, so no cover estimate"
      : `${row.daysOfCover} days of cover`;
  const head = `${row.name}: ${row.onHandQuantity} ${row.unit} on hand, ${row.dailyConsumption} ${row.unit}/day, ${cover}`;
  if (!row.belowReorderPoint) return head;
  const supplier = row.supplierName ? ` from ${row.supplierName}` : "";
  return `${head} — at or below reorder point, order ${row.suggestedOrderQuantity} ${row.unit}${supplier}`;
}
