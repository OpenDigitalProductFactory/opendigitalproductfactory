import { describe, it, expect } from "vitest";
import { applyStockMovement, type StockState } from "./stock";

const empty: StockState = { quantity: 0, unitCost: 0 };

describe("applyStockMovement — weighted average", () => {
  it("a receipt into empty stock sets qty and unit cost", () => {
    const r = applyStockMovement(empty, { type: "receipt", quantity: 10, unitCost: 5 });
    expect(r.state).toEqual({ quantity: 10, unitCost: 5 });
    expect(r.valueDelta).toBe(50);
    expect(r.cogs).toBe(0);
  });

  it("a second receipt at a different cost re-averages the unit cost", () => {
    const after1 = applyStockMovement(empty, { type: "receipt", quantity: 10, unitCost: 5 }).state;
    const r = applyStockMovement(after1, { type: "receipt", quantity: 10, unitCost: 7 });
    // (10×5 + 10×7) / 20 = 6
    expect(r.state).toEqual({ quantity: 20, unitCost: 6 });
    expect(r.valueDelta).toBe(70);
  });

  it("an issue leaves at the current average and books COGS", () => {
    const start: StockState = { quantity: 20, unitCost: 6 };
    const r = applyStockMovement(start, { type: "issue", quantity: 5 });
    expect(r.state).toEqual({ quantity: 15, unitCost: 6 });
    expect(r.cogs).toBe(30); // 5 × 6
    expect(r.valueDelta).toBe(-30);
    expect(r.quantityDelta).toBe(-5);
  });

  it("an over-issue is capped at what is on hand (no negative stock)", () => {
    const start: StockState = { quantity: 3, unitCost: 10 };
    const r = applyStockMovement(start, { type: "issue", quantity: 10 });
    expect(r.state.quantity).toBe(0);
    expect(r.cogs).toBe(30); // only the 3 held × 10
    expect(r.quantityDelta).toBe(-3);
  });

  it("a positive adjustment adds stock at the current average", () => {
    const start: StockState = { quantity: 10, unitCost: 4 };
    const r = applyStockMovement(start, { type: "adjustment", quantity: 5 });
    expect(r.state).toEqual({ quantity: 15, unitCost: 4 });
    expect(r.valueDelta).toBe(20); // 5 × 4
  });

  it("a negative adjustment is clamped so stock never goes below zero", () => {
    const start: StockState = { quantity: 2, unitCost: 4 };
    const r = applyStockMovement(start, { type: "adjustment", quantity: -5 });
    expect(r.state.quantity).toBe(0);
    expect(r.quantityDelta).toBe(-2);
    expect(r.valueDelta).toBe(-8); // only the 2 removed × 4
  });

  it("re-averaging avoids float drift", () => {
    const after1 = applyStockMovement(empty, { type: "receipt", quantity: 3, unitCost: 0.1 }).state;
    const r = applyStockMovement(after1, { type: "receipt", quantity: 3, unitCost: 0.2 });
    expect(r.state.unitCost).toBe(0.15);
  });
});
