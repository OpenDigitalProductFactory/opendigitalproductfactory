import { describe, it, expect } from "vitest";
import { round2, calcLineItem, buildInvoiceTotals } from "@/lib/finance/invoice-totals";

describe("round2", () => {
  it("rounds to two decimals", () => {
    expect(round2(1.004)).toBe(1);
    expect(round2(1.006)).toBe(1.01);
    expect(round2(10)).toBe(10);
    expect(round2(2.345)).toBe(2.35);
  });

  it("rounds an exact-half float down when the binary representation falls short", () => {
    // Documented, not aspirational: 1.005 is stored as 1.00499999999999989…, so
    // 1.005 * 100 === 100.49999999999999 and Math.round yields 100. This is the
    // long-standing behaviour of this helper — captured here so a future change
    // to the rounding strategy is a deliberate decision with a failing test,
    // rather than a silent shift in what customers get billed.
    expect(round2(1.005)).toBe(1);
  });
});

describe("calcLineItem", () => {
  it("applies discount before tax", () => {
    // 10 x 100 = 1000; 10% discount = 900; 20% tax on 900 = 180; total 1080.
    // Taxing before discounting would give 1080 tax-inclusive off a 1200 base — wrong.
    expect(calcLineItem(10, 100, 20, 10)).toEqual({
      lineSubtotal: 1000,
      lineDiscount: 100,
      lineAfterDiscount: 900,
      lineTax: 180,
      lineTotal: 1080,
    });
  });

  it("handles zero tax and zero discount", () => {
    expect(calcLineItem(3, 25, 0, 0)).toEqual({
      lineSubtotal: 75,
      lineDiscount: 0,
      lineAfterDiscount: 75,
      lineTax: 0,
      lineTotal: 75,
    });
  });

  it("handles fractional quantities", () => {
    const r = calcLineItem(1.5, 33.33, 0, 0);
    expect(r.lineSubtotal).toBe(50);
    expect(r.lineTotal).toBe(50);
  });

  it("handles a full discount", () => {
    const r = calcLineItem(2, 50, 20, 100);
    expect(r.lineAfterDiscount).toBe(0);
    expect(r.lineTax).toBe(0);
    expect(r.lineTotal).toBe(0);
  });
});

describe("buildInvoiceTotals", () => {
  it("sums line items into invoice-level totals", () => {
    const result = buildInvoiceTotals([
      { description: "A", quantity: 10, unitPrice: 100, taxRate: 20, discountPercent: 10 },
      { description: "B", quantity: 2, unitPrice: 50, taxRate: 0, discountPercent: 0 },
    ]);

    expect(result.subtotal).toBe(1100);
    expect(result.discountAmount).toBe(100);
    expect(result.taxAmount).toBe(180);
    expect(result.totalAmount).toBe(1180);
  });

  it("keeps the header equal to the sum of the stored lines", () => {
    const result = buildInvoiceTotals([
      { description: "A", quantity: 3, unitPrice: 33.33, taxRate: 17.5, discountPercent: 3 },
      { description: "B", quantity: 7, unitPrice: 1.99, taxRate: 5, discountPercent: 0 },
      { description: "C", quantity: 1, unitPrice: 0.01, taxRate: 20, discountPercent: 0 },
    ]);

    const summed = round2(result.lineItemsData.reduce((acc, l) => round2(acc + l.lineTotal), 0));
    expect(summed).toBe(result.totalAmount);
  });

  it("assigns sortOrder from input order", () => {
    const result = buildInvoiceTotals([
      { description: "first", quantity: 1, unitPrice: 1 },
      { description: "second", quantity: 1, unitPrice: 1 },
      { description: "third", quantity: 1, unitPrice: 1 },
    ]);
    expect(result.lineItemsData.map((l) => [l.description, l.sortOrder])).toEqual([
      ["first", 0],
      ["second", 1],
      ["third", 2],
    ]);
  });

  it("defaults missing tax, discount, and accountCode", () => {
    const [line] = buildInvoiceTotals([{ description: "A", quantity: 1, unitPrice: 10 }])
      .lineItemsData;
    expect(line.taxRate).toBe(0);
    expect(line.discountPercent).toBe(0);
    expect(line.accountCode).toBeNull();
  });

  it("returns zeroed totals for an empty set", () => {
    const result = buildInvoiceTotals([]);
    expect(result).toEqual({
      lineItemsData: [],
      subtotal: 0,
      discountAmount: 0,
      taxAmount: 0,
      totalAmount: 0,
    });
  });
});
