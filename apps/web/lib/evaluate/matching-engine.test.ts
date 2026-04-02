import { describe, expect, it } from "vitest";
import { findMatches, applyBankRules } from "./matching-engine";

const payments = [
  { id: "p1", paymentRef: "PAY-2026-0001", amount: 150, receivedAt: new Date("2026-03-20"), counterpartyId: null, reference: "INV-001" },
  { id: "p2", paymentRef: "PAY-2026-0002", amount: 150, receivedAt: new Date("2026-03-25"), counterpartyId: null, reference: null },
  { id: "p3", paymentRef: "PAY-2026-0003", amount: 300, receivedAt: new Date("2026-03-20"), counterpartyId: null, reference: null },
];

describe("findMatches", () => {
  it("gives high confidence for exact amount + close date", () => {
    const tx = { amount: 150, date: new Date("2026-03-20"), description: "Payment", reference: undefined };
    const matches = findMatches(tx, payments);
    expect(matches[0].paymentId).toBe("p1");
    expect(matches[0].confidence).toBeGreaterThanOrEqual(60);
  });

  it("boosts confidence for reference match", () => {
    const tx = { amount: 150, date: new Date("2026-03-21"), description: "INV-001 payment", reference: "INV-001" };
    const matches = findMatches(tx, payments);
    expect(matches[0].paymentId).toBe("p1");
    expect(matches[0].confidence).toBeGreaterThanOrEqual(80);
  });

  it("returns multiple candidates sorted by confidence", () => {
    const tx = { amount: 150, date: new Date("2026-03-22"), description: "Transfer", reference: undefined };
    const matches = findMatches(tx, payments);
    expect(matches.length).toBeGreaterThanOrEqual(2);
    expect(matches[0].confidence).toBeGreaterThanOrEqual(matches[1].confidence);
  });

  it("returns empty when no amount match", () => {
    const tx = { amount: 999, date: new Date("2026-03-20"), description: "Unknown", reference: undefined };
    const matches = findMatches(tx, payments);
    expect(matches).toHaveLength(0);
  });

  it("includes matchReasons in results", () => {
    const tx = { amount: 150, date: new Date("2026-03-20"), description: "Payment", reference: undefined };
    const matches = findMatches(tx, payments);
    expect(matches[0].matchReasons.length).toBeGreaterThan(0);
  });

  it("includes payment date in MatchCandidate", () => {
    const tx = { amount: 150, date: new Date("2026-03-20"), description: "Payment", reference: undefined };
    const matches = findMatches(tx, payments);
    expect(matches[0].date).toBeInstanceOf(Date);
  });

  it("includes paymentRef in MatchCandidate", () => {
    const tx = { amount: 150, date: new Date("2026-03-20"), description: "Payment", reference: undefined };
    const matches = findMatches(tx, payments);
    expect(typeof matches[0].paymentRef).toBe("string");
  });

  it("accepts amount within 1% as near-exact match", () => {
    // 150 * 1.005 = 150.75 — within 1%
    const tx = { amount: 150.75, date: new Date("2026-03-20"), description: "Payment", reference: undefined };
    const matches = findMatches(tx, payments);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].confidence).toBeGreaterThan(30);
  });
});

describe("applyBankRules", () => {
  const rules = [
    { matchField: "description", matchType: "contains", matchValue: "NETFLIX", accountCode: "6100", category: "subscriptions", taxRate: undefined, description: "Netflix subscription", isActive: true },
    { matchField: "description", matchType: "exact", matchValue: "SALARY", accountCode: "2000", category: "payroll", taxRate: undefined, description: undefined, isActive: true },
    { matchField: "description", matchType: "starts_with", matchValue: "DD ", accountCode: "7000", category: "direct_debit", taxRate: undefined, description: "Direct debit", isActive: true },
    { matchField: "description", matchType: "contains", matchValue: "DISABLED", accountCode: "9999", category: "test", taxRate: undefined, description: undefined, isActive: false },
  ];

  it("matches contains rule", () => {
    const result = applyBankRules({ description: "NETFLIX MONTHLY", reference: undefined, amount: -15.99 }, rules);
    expect(result?.category).toBe("subscriptions");
    expect(result?.accountCode).toBe("6100");
  });

  it("matches exact rule", () => {
    const result = applyBankRules({ description: "SALARY", reference: undefined, amount: 3000 }, rules);
    expect(result?.category).toBe("payroll");
  });

  it("matches starts_with rule", () => {
    const result = applyBankRules({ description: "DD BROADBAND", reference: undefined, amount: -40 }, rules);
    expect(result?.category).toBe("direct_debit");
  });

  it("skips inactive rules", () => {
    const result = applyBankRules({ description: "DISABLED TEST", reference: undefined, amount: 10 }, rules);
    expect(result).toBeNull();
  });

  it("returns null when no rule matches", () => {
    const result = applyBankRules({ description: "Random purchase", reference: undefined, amount: -25 }, rules);
    expect(result).toBeNull();
  });

  it("is case-insensitive for contains", () => {
    const result = applyBankRules({ description: "netflix premium", reference: undefined, amount: -15.99 }, rules);
    expect(result?.category).toBe("subscriptions");
  });

  it("is case-insensitive for exact", () => {
    const result = applyBankRules({ description: "salary", reference: undefined, amount: 3000 }, rules);
    expect(result?.category).toBe("payroll");
  });

  it("returns accountCode from matched rule", () => {
    const result = applyBankRules({ description: "NETFLIX MONTHLY", reference: undefined, amount: -15.99 }, rules);
    expect(result?.accountCode).toBe("6100");
  });

  it("returns description from matched rule when present", () => {
    const result = applyBankRules({ description: "NETFLIX MONTHLY", reference: undefined, amount: -15.99 }, rules);
    expect(result?.description).toBe("Netflix subscription");
  });
});
