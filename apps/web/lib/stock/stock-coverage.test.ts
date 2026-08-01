import { describe, expect, it } from "vitest";

import {
  computeStockCoverage,
  describeCoverageRow,
  type ComponentLine,
  type StockLevel,
} from "./stock-coverage";

// The live restaurant exercise shape: 11 Margherita Pizzas sold in the window,
// each consuming 0.2 kg mozzarella and 0.15 kg tomato.
const PIZZA = "item-pizza";
const SALAD = "item-salad";

const stock: StockLevel[] = [
  {
    stockItemId: "stock-mozzarella",
    name: "Mozzarella",
    unit: "kg",
    onHandQuantity: 2,
    reorderPoint: 3,
    reorderQuantity: 10,
    supplierName: "Greenfield Logistics",
  },
  {
    stockItemId: "stock-tomato",
    name: "San Marzano Tomatoes",
    unit: "kg",
    onHandQuantity: 20,
    reorderPoint: 5,
    reorderQuantity: 12,
    supplierName: null,
  },
  {
    stockItemId: "stock-napkins",
    name: "Napkins",
    unit: "case",
    onHandQuantity: 4,
    reorderPoint: 2,
    reorderQuantity: 0,
    supplierName: null,
  },
];

const components: ComponentLine[] = [
  { storefrontItemId: PIZZA, stockItemId: "stock-mozzarella", quantityPerUnit: 0.2 },
  { storefrontItemId: PIZZA, stockItemId: "stock-tomato", quantityPerUnit: 0.15 },
  { storefrontItemId: SALAD, stockItemId: "stock-tomato", quantityPerUnit: 0.1 },
];

describe("computeStockCoverage", () => {
  it("derives consumption from sales x recipe and projects days of cover", () => {
    const rows = computeStockCoverage({
      stock,
      components,
      sold: [{ storefrontItemId: PIZZA, units: 11 }],
      windowDays: 2,
    });
    const mozzarella = rows.find((r) => r.stockItemId === "stock-mozzarella")!;
    expect(mozzarella.consumedInWindow).toBe(2.2); // 11 x 0.2
    expect(mozzarella.dailyConsumption).toBe(1.1); // over 2 days
    expect(mozzarella.daysOfCover).toBe(1.8); // 2 kg on hand / 1.1
    expect(mozzarella.belowReorderPoint).toBe(true);
    expect(mozzarella.suggestedOrderQuantity).toBe(10); // configured reorder quantity
  });

  it("sums a stock item consumed by more than one sellable item", () => {
    const rows = computeStockCoverage({
      stock,
      components,
      sold: [
        { storefrontItemId: PIZZA, units: 10 },
        { storefrontItemId: SALAD, units: 4 },
      ],
      windowDays: 1,
    });
    const tomato = rows.find((r) => r.stockItemId === "stock-tomato")!;
    expect(tomato.consumedInWindow).toBe(1.9); // 10x0.15 + 4x0.1
  });

  it("reports no cover estimate rather than infinite cover when nothing was consumed", () => {
    const rows = computeStockCoverage({
      stock,
      components,
      sold: [],
      windowDays: 7,
    });
    for (const row of rows) {
      expect(row.consumedInWindow).toBe(0);
      expect(row.daysOfCover).toBeNull();
    }
  });

  it("falls back to clearing the reorder point when no reorder quantity is configured", () => {
    const rows = computeStockCoverage({
      stock: [
        {
          stockItemId: "stock-x",
          name: "Olive Oil",
          unit: "litre",
          onHandQuantity: 1,
          reorderPoint: 4,
          reorderQuantity: 0,
          supplierName: null,
        },
      ],
      components: [],
      sold: [],
      windowDays: 7,
    });
    expect(rows[0]!.belowReorderPoint).toBe(true);
    expect(rows[0]!.suggestedOrderQuantity).toBe(3); // 4 - 1
  });

  it("orders the most urgent first: below-reorder items, then shortest cover", () => {
    const rows = computeStockCoverage({
      stock,
      components,
      sold: [{ storefrontItemId: PIZZA, units: 11 }],
      windowDays: 2,
    });
    expect(rows[0]!.name).toBe("Mozzarella"); // only one below its reorder point
    // Tomato is consumed (finite cover) so it must rank ahead of untouched napkins.
    expect(rows[1]!.name).toBe("San Marzano Tomatoes");
    expect(rows[2]!.name).toBe("Napkins");
  });

  it("ignores malformed sales and recipe lines instead of poisoning the arithmetic", () => {
    const rows = computeStockCoverage({
      stock,
      components: [
        ...components,
        { storefrontItemId: PIZZA, stockItemId: "stock-mozzarella", quantityPerUnit: 0 },
      ],
      sold: [
        { storefrontItemId: PIZZA, units: 11 },
        { storefrontItemId: PIZZA, units: -5 },
        { storefrontItemId: SALAD, units: Number.NaN },
      ],
      windowDays: 2,
    });
    expect(rows.find((r) => r.stockItemId === "stock-mozzarella")!.consumedInWindow).toBe(2.2);
  });

  it("treats a non-positive window as one day rather than dividing by zero", () => {
    const rows = computeStockCoverage({
      stock,
      components,
      sold: [{ storefrontItemId: PIZZA, units: 5 }],
      windowDays: 0,
    });
    const mozzarella = rows.find((r) => r.stockItemId === "stock-mozzarella")!;
    expect(Number.isFinite(mozzarella.dailyConsumption)).toBe(true);
    expect(mozzarella.dailyConsumption).toBe(1); // 5 x 0.2 over 1 day
  });
});

describe("describeCoverageRow", () => {
  it("names the shortfall, the quantity, and the supplier when below the reorder point", () => {
    const [row] = computeStockCoverage({
      stock: [stock[0]!],
      components,
      sold: [{ storefrontItemId: PIZZA, units: 11 }],
      windowDays: 2,
    });
    expect(describeCoverageRow(row!)).toBe(
      "Mozzarella: 2 kg on hand, 1.1 kg/day, 1.8 days of cover — at or below reorder point, order 10 kg from Greenfield Logistics",
    );
  });

  it("says plainly when there is no usage to project from", () => {
    const [row] = computeStockCoverage({
      stock: [stock[2]!],
      components,
      sold: [],
      windowDays: 7,
    });
    expect(describeCoverageRow(row!)).toContain("no usage in this window");
  });
});
