import { describe, expect, it } from "vitest";

import {
  ORDER_STATUSES,
  ORDER_TRANSITIONS,
  canTransitionOrder,
  isOrderStatus,
  nextActionForOrder,
  summarizeOrderItems,
} from "./order-lifecycle";

describe("order status vocabulary", () => {
  it("recognises every canonical status and rejects strangers", () => {
    for (const status of ORDER_STATUSES) expect(isOrderStatus(status)).toBe(true);
    expect(isOrderStatus("shipped")).toBe(false);
    expect(isOrderStatus("")).toBe(false);
    expect(isOrderStatus(null)).toBe(false);
  });

  it("keeps terminal states terminal", () => {
    expect(ORDER_TRANSITIONS.fulfilled).toHaveLength(0);
    expect(ORDER_TRANSITIONS.cancelled).toHaveLength(0);
  });
});

describe("canTransitionOrder", () => {
  it("walks the happy lane pending → accepted → ready → fulfilled", () => {
    expect(canTransitionOrder("pending", "accepted")).toBe(true);
    expect(canTransitionOrder("accepted", "ready")).toBe(true);
    expect(canTransitionOrder("ready", "fulfilled")).toBe(true);
  });

  it("allows cancel from every non-terminal state only", () => {
    expect(canTransitionOrder("pending", "cancelled")).toBe(true);
    expect(canTransitionOrder("accepted", "cancelled")).toBe(true);
    expect(canTransitionOrder("ready", "cancelled")).toBe(true);
    expect(canTransitionOrder("fulfilled", "cancelled")).toBe(false);
    expect(canTransitionOrder("cancelled", "cancelled")).toBe(false);
  });

  it("refuses skips, reversals, and unknown states", () => {
    expect(canTransitionOrder("pending", "ready")).toBe(false);
    expect(canTransitionOrder("pending", "fulfilled")).toBe(false);
    expect(canTransitionOrder("ready", "accepted")).toBe(false);
    expect(canTransitionOrder("shipped", "fulfilled")).toBe(false);
    expect(canTransitionOrder("pending", "shipped")).toBe(false);
  });
});

describe("nextActionForOrder", () => {
  it("gives a concrete owner instruction per status", () => {
    expect(nextActionForOrder("pending")).toMatch(/accept/i);
    expect(nextActionForOrder("accepted")).toMatch(/ready/i);
    expect(nextActionForOrder("ready")).toMatch(/fulfilled/i);
    expect(nextActionForOrder("fulfilled")).toMatch(/no action needed/i);
    expect(nextActionForOrder("cancelled")).toMatch(/no action needed/i);
  });

  it("degrades to a generic review line for unknown status", () => {
    expect(nextActionForOrder("mystery")).toBe("Review this order");
  });
});

describe("summarizeOrderItems", () => {
  it("summarises a single line item with quantity", () => {
    expect(summarizeOrderItems([{ qty: 2, name: "Margherita Pizza", unitPrice: 16 }])).toBe(
      "2× Margherita Pizza",
    );
  });

  it("collapses extra lines into a +N more suffix", () => {
    expect(
      summarizeOrderItems([
        { qty: 1, name: "Caesar Salad" },
        { qty: 2, name: "Tiramisu" },
        { qty: 1, name: "Bruschetta" },
      ]),
    ).toBe("Caesar Salad +2 more");
  });

  it("returns null for empty or malformed items JSON", () => {
    expect(summarizeOrderItems([])).toBeNull();
    expect(summarizeOrderItems(null)).toBeNull();
    expect(summarizeOrderItems("not-an-array")).toBeNull();
    expect(summarizeOrderItems([{ qty: 3 }])).toBeNull();
  });
});
