import { describe, expect, it } from "vitest";
import {
  createInvoiceSchema,
  recordPaymentSchema,
  INVOICE_TYPES,
  INVOICE_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_DIRECTIONS,
} from "./finance-validation";

describe("createInvoiceSchema", () => {
  const validInput = {
    accountId: "cuid123",
    dueDate: "2026-04-20",
    currency: "GBP",
    paymentTerms: "Net 30",
    lineItems: [
      { description: "Consulting", quantity: 2, unitPrice: 150, taxRate: 20 },
    ],
  };

  it("accepts valid invoice input", () => {
    const result = createInvoiceSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it("rejects empty lineItems", () => {
    const result = createInvoiceSchema.safeParse({ ...validInput, lineItems: [] });
    expect(result.success).toBe(false);
  });

  it("rejects missing accountId", () => {
    const { accountId, ...rest } = validInput;
    const result = createInvoiceSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing dueDate", () => {
    const { dueDate, ...rest } = validInput;
    const result = createInvoiceSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects negative unitPrice", () => {
    const input = {
      ...validInput,
      lineItems: [{ description: "Bad", quantity: 1, unitPrice: -10, taxRate: 0 }],
    };
    const result = createInvoiceSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects zero quantity", () => {
    const input = {
      ...validInput,
      lineItems: [{ description: "Zero", quantity: 0, unitPrice: 100, taxRate: 0 }],
    };
    const result = createInvoiceSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("accepts valid invoice types", () => {
    for (const type of INVOICE_TYPES) {
      const result = createInvoiceSchema.safeParse({ ...validInput, type });
      expect(result.success).toBe(true);
    }
  });
});

describe("recordPaymentSchema", () => {
  const validPayment = {
    direction: "inbound",
    method: "bank_transfer",
    amount: 300,
    currency: "GBP",
    invoiceId: "inv123",
  };

  it("accepts valid payment input", () => {
    const result = recordPaymentSchema.safeParse(validPayment);
    expect(result.success).toBe(true);
  });

  it("rejects invalid direction", () => {
    const result = recordPaymentSchema.safeParse({ ...validPayment, direction: "sideways" });
    expect(result.success).toBe(false);
  });

  it("rejects zero amount", () => {
    const result = recordPaymentSchema.safeParse({ ...validPayment, amount: 0 });
    expect(result.success).toBe(false);
  });

  it("accepts all valid payment methods", () => {
    for (const method of PAYMENT_METHODS) {
      const result = recordPaymentSchema.safeParse({ ...validPayment, method });
      expect(result.success).toBe(true);
    }
  });
});
