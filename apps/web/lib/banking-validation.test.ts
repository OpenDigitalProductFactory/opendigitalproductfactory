import { describe, expect, it } from "vitest";
import {
  createBankAccountSchema,
  matchTransactionSchema,
  createBankRuleSchema,
  ACCOUNT_TYPES,
  MATCH_FIELDS,
  MATCH_TYPES,
} from "./banking-validation";

describe("createBankAccountSchema", () => {
  const validInput = {
    name: "Main Business Account",
    bankName: "Barclays",
    currency: "GBP",
    accountType: "current" as const,
    openingBalance: 0,
  };

  it("accepts valid bank account input", () => {
    const result = createBankAccountSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = createBankAccountSchema.safeParse({ ...validInput, name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects missing name", () => {
    const { name, ...rest } = validInput;
    const result = createBankAccountSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects invalid accountType", () => {
    const result = createBankAccountSchema.safeParse({ ...validInput, accountType: "investment" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid currency length", () => {
    const result = createBankAccountSchema.safeParse({ ...validInput, currency: "GBPP" });
    expect(result.success).toBe(false);
  });

  it("rejects currency shorter than 3 chars", () => {
    const result = createBankAccountSchema.safeParse({ ...validInput, currency: "GB" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid account types", () => {
    for (const accountType of ACCOUNT_TYPES) {
      const result = createBankAccountSchema.safeParse({ ...validInput, accountType });
      expect(result.success).toBe(true);
    }
  });

  it("defaults currency to GBP when omitted", () => {
    const { currency, ...rest } = validInput;
    const result = createBankAccountSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.currency).toBe("GBP");
    }
  });

  it("defaults accountType to current when omitted", () => {
    const { accountType, ...rest } = validInput;
    const result = createBankAccountSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.accountType).toBe("current");
    }
  });

  it("defaults openingBalance to 0 when omitted", () => {
    const { openingBalance, ...rest } = validInput;
    const result = createBankAccountSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.openingBalance).toBe(0);
    }
  });

  it("accepts optional fields like iban and swift", () => {
    const result = createBankAccountSchema.safeParse({
      ...validInput,
      iban: "GB29NWBK60161331926819",
      swift: "NWBKGB2L",
    });
    expect(result.success).toBe(true);
  });
});

describe("matchTransactionSchema", () => {
  const validInput = {
    transactionId: "tx_abc123",
    paymentId: "pay_xyz789",
  };

  it("accepts valid match input", () => {
    const result = matchTransactionSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it("rejects empty transactionId", () => {
    const result = matchTransactionSchema.safeParse({ ...validInput, transactionId: "" });
    expect(result.success).toBe(false);
  });

  it("rejects empty paymentId", () => {
    const result = matchTransactionSchema.safeParse({ ...validInput, paymentId: "" });
    expect(result.success).toBe(false);
  });

  it("rejects missing transactionId", () => {
    const { transactionId, ...rest } = validInput;
    const result = matchTransactionSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing paymentId", () => {
    const { paymentId, ...rest } = validInput;
    const result = matchTransactionSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe("createBankRuleSchema", () => {
  const validInput = {
    name: "Netflix Rule",
    matchField: "description" as const,
    matchType: "contains" as const,
    matchValue: "NETFLIX",
    accountCode: "6100",
    category: "subscriptions",
  };

  it("accepts valid bank rule input", () => {
    const result = createBankRuleSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = createBankRuleSchema.safeParse({ ...validInput, name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects empty matchValue", () => {
    const result = createBankRuleSchema.safeParse({ ...validInput, matchValue: "" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid matchField", () => {
    const result = createBankRuleSchema.safeParse({ ...validInput, matchField: "amount" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid matchType", () => {
    const result = createBankRuleSchema.safeParse({ ...validInput, matchType: "regex" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid match fields", () => {
    for (const matchField of MATCH_FIELDS) {
      const result = createBankRuleSchema.safeParse({ ...validInput, matchField });
      expect(result.success).toBe(true);
    }
  });

  it("accepts all valid match types", () => {
    for (const matchType of MATCH_TYPES) {
      const result = createBankRuleSchema.safeParse({ ...validInput, matchType });
      expect(result.success).toBe(true);
    }
  });

  it("defaults matchType to contains when omitted", () => {
    const { matchType, ...rest } = validInput;
    const result = createBankRuleSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.matchType).toBe("contains");
    }
  });

  it("rejects taxRate above 100", () => {
    const result = createBankRuleSchema.safeParse({ ...validInput, taxRate: 101 });
    expect(result.success).toBe(false);
  });

  it("rejects taxRate below 0", () => {
    const result = createBankRuleSchema.safeParse({ ...validInput, taxRate: -1 });
    expect(result.success).toBe(false);
  });

  it("accepts taxRate of 0", () => {
    const result = createBankRuleSchema.safeParse({ ...validInput, taxRate: 0 });
    expect(result.success).toBe(true);
  });

  it("accepts taxRate of 100", () => {
    const result = createBankRuleSchema.safeParse({ ...validInput, taxRate: 100 });
    expect(result.success).toBe(true);
  });
});
