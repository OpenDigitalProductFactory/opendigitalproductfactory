import { describe, expect, it } from "vitest";
import {
  createExpenseClaimSchema,
  updateExpenseClaimSchema,
  EXPENSE_CATEGORIES,
} from "./expense-validation";

const validItem = {
  date: "2026-03-01",
  category: "travel" as const,
  description: "Train to London",
  amount: 45.50,
  currency: "GBP",
};

const validInput = {
  title: "March 2026 Expenses",
  currency: "GBP",
  items: [validItem],
};

// ─── createExpenseClaimSchema ──────────────────────────────────────────────────

describe("createExpenseClaimSchema", () => {
  it("accepts valid input with one item", () => {
    const result = createExpenseClaimSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it("rejects empty items array", () => {
    const result = createExpenseClaimSchema.safeParse({ ...validInput, items: [] });
    expect(result.success).toBe(false);
  });

  it("rejects missing title", () => {
    const result = createExpenseClaimSchema.safeParse({ ...validInput, title: "" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid category", () => {
    const result = createExpenseClaimSchema.safeParse({
      ...validInput,
      items: [{ ...validItem, category: "snacks" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative amount", () => {
    const result = createExpenseClaimSchema.safeParse({
      ...validInput,
      items: [{ ...validItem, amount: -10 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects zero amount", () => {
    const result = createExpenseClaimSchema.safeParse({
      ...validInput,
      items: [{ ...validItem, amount: 0 }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts all valid EXPENSE_CATEGORIES", () => {
    for (const category of EXPENSE_CATEGORIES) {
      const result = createExpenseClaimSchema.safeParse({
        ...validInput,
        items: [{ ...validItem, category }],
      });
      expect(result.success).toBe(true);
    }
  });

  it("accepts multiple items", () => {
    const result = createExpenseClaimSchema.safeParse({
      ...validInput,
      items: [validItem, { ...validItem, category: "meals", amount: 22.0 }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts optional notes", () => {
    const result = createExpenseClaimSchema.safeParse({ ...validInput, notes: "Team travel" });
    expect(result.success).toBe(true);
  });

  it("defaults currency to GBP when omitted", () => {
    const { currency: _, ...withoutCurrency } = validInput;
    const result = createExpenseClaimSchema.safeParse(withoutCurrency);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.currency).toBe("GBP");
    }
  });
});

// ─── updateExpenseClaimSchema ──────────────────────────────────────────────────

describe("updateExpenseClaimSchema", () => {
  it("accepts valid status update", () => {
    const result = updateExpenseClaimSchema.safeParse({ status: "submitted" });
    expect(result.success).toBe(true);
  });

  it("accepts rejected reason", () => {
    const result = updateExpenseClaimSchema.safeParse({ status: "rejected", rejectedReason: "Missing receipts" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid status", () => {
    const result = updateExpenseClaimSchema.safeParse({ status: "pending" });
    expect(result.success).toBe(false);
  });

  it("accepts empty object (all fields optional)", () => {
    const result = updateExpenseClaimSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});
