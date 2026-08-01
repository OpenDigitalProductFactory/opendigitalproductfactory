import { describe, expect, it } from "vitest";
import { stockCoveragePack, tallySoldUnits } from "./stock-coverage-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

describe("stock-coverage pack", () => {
  it("registers list_stock_coverage as a read-only view_storefront tool", () => {
    const def = stockCoveragePack.definitions.find((d) => d.name === "list_stock_coverage");
    expect(def).toBeDefined();
    expect(def!.requiredCapability).toBe("view_storefront");
    expect(def!.sideEffect).toBe(false);
    expect(stockCoveragePack.handlers.list_stock_coverage).toBeTypeOf("function");
  });

  it("gates the tool behind stock_read and mirrors the shared grant map", () => {
    expect(stockCoveragePack.grants.list_stock_coverage).toEqual(["stock_read"]);
    expect(isToolAllowedByGrants("list_stock_coverage", ["stock_read"])).toBe(true);
    expect(isToolAllowedByGrants("list_stock_coverage", ["storefront_read"])).toBe(false);
    expect(isToolAllowedByGrants("list_stock_coverage", ["backlog_read"])).toBe(false);
  });

  it("keeps the tool description provenance-free and steers away from a one-day window", () => {
    const def = stockCoveragePack.definitions[0]!;
    expect(def.description).not.toMatch(/BI-|Phase \d|apps\/web|EP-/);
    // BI-D1E5E722 follow-through: a same-day window silently reads as "no demand".
    expect(def.description).toMatch(/multi-day/i);
  });
});

describe("tallySoldUnits", () => {
  it("sums units per storefront item across orders", () => {
    expect(
      tallySoldUnits([
        [{ qty: 2, itemId: "ITEM-PIZZA" }],
        [{ qty: 3, itemId: "ITEM-PIZZA" }, { qty: 1, itemId: "ITEM-SALAD" }],
      ]),
    ).toEqual([
      { storefrontItemId: "ITEM-PIZZA", units: 5 },
      { storefrontItemId: "ITEM-SALAD", units: 1 },
    ]);
  });

  it("defaults a missing quantity to one and skips lines with no item id", () => {
    expect(tallySoldUnits([[{ itemId: "ITEM-PIZZA" }, { qty: 4 }]])).toEqual([
      { storefrontItemId: "ITEM-PIZZA", units: 1 },
    ]);
  });

  it("tolerates malformed payloads", () => {
    expect(tallySoldUnits(["not-an-array", null, undefined, [{}]])).toEqual([]);
  });
});
