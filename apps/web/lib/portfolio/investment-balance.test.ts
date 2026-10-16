import { describe, expect, it } from "vitest";
import { classifyInvestment, defaultBalancePolicy, evaluateInvestmentBalance, validateBalancePolicy } from "./investment-balance";

const now = new Date("2026-10-13T12:00:00Z");
const measured = { knownAttempts: 20, unknownAttempts: 0, refactorTokens: 2000, newTokens: 8000, unclassifiedTokens: 0, latestAt: now.toISOString() };

describe("owner-scoped investment balance", () => {
  it("keeps the founder's shared work distinct from organization and archetype work", () => {
    expect(defaultBalancePolicy("founder", "shared-platform").refactorPercent).toBe(80);
    expect(defaultBalancePolicy("founder", "archetype").refactorPercent).toBe(20);
    expect(defaultBalancePolicy("organization", "shared-platform").refactorPercent).toBe(20);
    expect(defaultBalancePolicy("organization", "archetype").refactorPercent).toBe(20);
  });
  it.each(["bug", "refactor"])("counts %s as refactoring", (kind) => expect(classifyInvestment(kind)).toBe("refactor"));
  it("does not silently classify unrelated work", () => {
    expect(classifyInvestment("feature")).toBe("new");
    expect(classifyInvestment("chore")).toBeNull();
    expect(classifyInvestment(null)).toBeNull();
  });
  it("does not enable measured steering merely by deriving a target", () => {
    expect(evaluateInvestmentBalance(defaultBalancePolicy("founder", "shared-platform"), measured, now).suppression).toBe("not-enabled");
  });
  it("steers toward the owner's target with sufficient fresh evidence", () => {
    const policy = { ...defaultBalancePolicy("founder", "shared-platform"), steeringEnabled: true };
    expect(evaluateInvestmentBalance(policy, measured, now)).toMatchObject({ preferred: "refactor", actualRefactorPercent: 20, suppression: null });
    expect(evaluateInvestmentBalance({ ...policy, refactorPercent: 20 }, { ...measured, refactorTokens: 8000, newTokens: 2000 }, now).preferred).toBe("new");
  });
  it.each([
    [{ knownAttempts: 19 }, "insufficient-attempts"],
    [{ refactorTokens: 1000, newTokens: 1000 }, "insufficient-tokens"],
    [{ unclassifiedTokens: 3000 }, "insufficient-classification"],
    [{ latestAt: "2026-10-01T00:00:00Z" }, "stale"],
    [{ latestAt: null }, "stale"],
  ])("suppresses steering for inadequate observation %o", (change, reason) => {
    const policy = { ...defaultBalancePolicy("founder", "shared-platform"), steeringEnabled: true };
    expect(evaluateInvestmentBalance(policy, { ...measured, ...change }, now).suppression).toBe(reason);
  });
  it("keeps unknown-token attempts visible without converting them into zero tokens", () => {
    const policy = { ...defaultBalancePolicy("founder", "shared-platform"), steeringEnabled: true };
    const result = evaluateInvestmentBalance(policy, { ...measured, unknownAttempts: 7 }, now);
    expect(result.unknownAttempts).toBe(7);
    expect(result.knownTokens).toBe(10000);
  });
  it("has a tolerance rather than demanding an exact ratio on every task", () => {
    const policy = { ...defaultBalancePolicy("founder", "shared-platform"), steeringEnabled: true };
    expect(evaluateInvestmentBalance(policy, { ...measured, refactorTokens: 7800, newTokens: 2200 }, now).preferred).toBeNull();
  });
  it("withholds steering when most scoped attempts have no usage", () => {
    const policy = { ...defaultBalancePolicy("founder", "shared-platform"), steeringEnabled: true };
    expect(evaluateInvestmentBalance(policy, { ...measured, unknownAttempts: 1000 }, now)).toMatchObject({ preferred: null, suppression: "insufficient-coverage" });
  });
  it("rejects totals outside safe integer precision", () => {
    const policy = { ...defaultBalancePolicy("founder", "shared-platform"), steeringEnabled: true };
    expect(evaluateInvestmentBalance(policy, { ...measured, refactorTokens: Number.MAX_SAFE_INTEGER }, now).suppression).toBe("invalid-observation");
  });
  it.each([{ windowDays: 181 }, { refactorPercent: -1 }, { refactorPercent: 101 }, { minimumAttempts: 0 }, { minimumTokens: NaN }, { minimumClassificationPercent: 101 }, { freshnessDays: 43 }])("rejects invalid policy bounds %o", (change) => {
    expect(validateBalancePolicy({ ...defaultBalancePolicy("founder", "shared-platform"), ...change })).toBe(false);
  });
});
