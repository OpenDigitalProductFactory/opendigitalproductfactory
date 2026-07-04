import { describe, it, expect } from "vitest";
import {
  matchBillToPurchaseOrder,
  DEFAULT_MATCH_TOLERANCE,
  type MatchDocument,
} from "./po-match";

const po: MatchDocument = { subtotal: 1000, taxAmount: 200, totalAmount: 1200 };

describe("matchBillToPurchaseOrder", () => {
  it("matches an identical bill", () => {
    const m = matchBillToPurchaseOrder({ subtotal: 1000, taxAmount: 200, totalAmount: 1200 }, po);
    expect(m.matched).toBe(true);
    expect(m.status).toBe("matched");
    expect(m.variance).toBe(0);
  });

  it("matches within the percentage tolerance (2% of 1200 = 24)", () => {
    const m = matchBillToPurchaseOrder({ subtotal: 1020, taxAmount: 200, totalAmount: 1220 }, po);
    expect(m.matched).toBe(true); // +20 ≤ 24
  });

  it("flags an over-billing beyond tolerance as 'over'", () => {
    const m = matchBillToPurchaseOrder({ subtotal: 1100, taxAmount: 220, totalAmount: 1320 }, po);
    expect(m.matched).toBe(false);
    expect(m.status).toBe("over"); // +120, the cash-protecting case
    expect(m.variance).toBe(120);
    expect(m.message).toMatch(/exceeds the purchase order/i);
  });

  it("flags an under-billing beyond tolerance as 'under'", () => {
    const m = matchBillToPurchaseOrder({ subtotal: 800, taxAmount: 160, totalAmount: 960 }, po);
    expect(m.matched).toBe(false);
    expect(m.status).toBe("under");
    expect(m.variance).toBe(-240);
  });

  it("applies the absolute tolerance when it is larger than the percentage", () => {
    const smallPo: MatchDocument = { subtotal: 10, taxAmount: 0, totalAmount: 10 };
    // 2% of 10 = 0.20, but absolute floor is 1 → a 1.00 variance still matches.
    const m = matchBillToPurchaseOrder({ subtotal: 11, taxAmount: 0, totalAmount: 11 }, smallPo);
    expect(m.toleranceAmount).toBe(1);
    expect(m.matched).toBe(true);
  });

  it("respects a custom tolerance", () => {
    const strict = matchBillToPurchaseOrder(
      { subtotal: 1010, taxAmount: 200, totalAmount: 1210 },
      po,
      { absolute: 0, percent: 0 },
    );
    expect(strict.matched).toBe(false); // zero tolerance, +10 fails
    expect(strict.status).toBe("over");
  });

  it("computes a variance percentage against the PO total", () => {
    const m = matchBillToPurchaseOrder({ subtotal: 1200, taxAmount: 240, totalAmount: 1440 }, po);
    expect(m.variancePct).toBe(20); // 240 / 1200
  });

  it("exposes a default tolerance of 1 / 2%", () => {
    expect(DEFAULT_MATCH_TOLERANCE).toEqual({ absolute: 1, percent: 2 });
  });
});
