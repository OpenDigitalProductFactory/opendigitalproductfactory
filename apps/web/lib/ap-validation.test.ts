import { describe, expect, it } from "vitest";
import {
  createSupplierSchema,
  createBillSchema,
  createPOSchema,
  createPaymentRunSchema,
  updateBillSchema,
} from "./ap-validation";

describe("createSupplierSchema", () => {
  const validInput = {
    name: "Acme Supplies Ltd",
    contactName: "Jane Smith",
    email: "jane@acme.com",
    paymentTerms: "Net 30",
    defaultCurrency: "GBP",
  };

  it("accepts valid supplier input", () => {
    const result = createSupplierSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = createSupplierSchema.safeParse({ ...validInput, name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects missing name", () => {
    const { name, ...rest } = validInput;
    const result = createSupplierSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects invalid email", () => {
    const result = createSupplierSchema.safeParse({ ...validInput, email: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("rejects currency not 3 chars", () => {
    const result = createSupplierSchema.safeParse({ ...validInput, defaultCurrency: "GB" });
    expect(result.success).toBe(false);
  });

  it("applies default currency GBP when omitted", () => {
    const { defaultCurrency, ...rest } = validInput;
    const result = createSupplierSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.defaultCurrency).toBe("GBP");
  });
});

describe("createBillSchema", () => {
  const validInput = {
    supplierId: "sup-001",
    issueDate: "2026-03-01",
    dueDate: "2026-04-01",
    currency: "GBP",
    lineItems: [
      { description: "Consulting", quantity: 1, unitPrice: 500 },
    ],
  };

  it("accepts valid bill input", () => {
    const result = createBillSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it("rejects empty lineItems", () => {
    const result = createBillSchema.safeParse({ ...validInput, lineItems: [] });
    expect(result.success).toBe(false);
  });

  it("rejects missing supplierId", () => {
    const { supplierId, ...rest } = validInput;
    const result = createBillSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects empty supplierId", () => {
    const result = createBillSchema.safeParse({ ...validInput, supplierId: "" });
    expect(result.success).toBe(false);
  });

  it("rejects missing dueDate", () => {
    const { dueDate, ...rest } = validInput;
    const result = createBillSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("applies default taxRate 0 to line items", () => {
    const result = createBillSchema.safeParse(validInput);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.lineItems[0]!.taxRate).toBe(0);
  });
});

describe("updateBillSchema", () => {
  it("accepts valid status update", () => {
    const result = updateBillSchema.safeParse({ status: "approved" });
    expect(result.success).toBe(true);
  });

  it("rejects unknown status", () => {
    const result = updateBillSchema.safeParse({ status: "unknown_status" });
    expect(result.success).toBe(false);
  });

  it("accepts empty object (all optional)", () => {
    const result = updateBillSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe("createPOSchema", () => {
  const validInput = {
    supplierId: "sup-001",
    currency: "GBP",
    lineItems: [
      { description: "Office Supplies", quantity: 10, unitPrice: 25 },
    ],
  };

  it("accepts valid PO input", () => {
    const result = createPOSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it("rejects empty lineItems", () => {
    const result = createPOSchema.safeParse({ ...validInput, lineItems: [] });
    expect(result.success).toBe(false);
  });

  it("rejects missing supplierId", () => {
    const { supplierId, ...rest } = validInput;
    const result = createPOSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe("createPaymentRunSchema", () => {
  const validInput = {
    billIds: ["bill-001", "bill-002"],
    consolidatePerSupplier: true,
  };

  it("accepts valid billIds array", () => {
    const result = createPaymentRunSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it("rejects empty billIds array", () => {
    const result = createPaymentRunSchema.safeParse({ ...validInput, billIds: [] });
    expect(result.success).toBe(false);
  });

  it("rejects billIds with empty string", () => {
    const result = createPaymentRunSchema.safeParse({ ...validInput, billIds: [""] });
    expect(result.success).toBe(false);
  });

  it("defaults consolidatePerSupplier to true", () => {
    const { consolidatePerSupplier, ...rest } = validInput;
    const result = createPaymentRunSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.consolidatePerSupplier).toBe(true);
  });
});
