import { describe, expect, it } from "vitest";

import { getPlatformDevPolicyState, resolveDevelopmentInvestmentTarget } from "./platform-dev-policy";

describe("getPlatformDevPolicyState", () => {
  it("returns policy_pending when config is missing", () => {
    expect(getPlatformDevPolicyState(null)).toBe("policy_pending");
  });

  it("maps fork_only to private", () => {
    expect(getPlatformDevPolicyState({ contributionMode: "fork_only" })).toBe("private");
  });

  it("maps selective to contributing", () => {
    expect(getPlatformDevPolicyState({ contributionMode: "selective" })).toBe("contributing");
  });

  it("maps contribute_all to contributing", () => {
    expect(getPlatformDevPolicyState({ contributionMode: "contribute_all" })).toBe("contributing");
  });
});

describe("owner-scoped development investment", () => {
  it("prioritizes reliability for founder-funded shared platform work", () => {
    expect(resolveDevelopmentInvestmentTarget({ budgetOwner: "founder", workPurpose: "shared-platform" }))
      .toEqual({ refactorPercent: 80, newWorkPercent: 20 });
  });
  it.each([
    { budgetOwner: "organization", workPurpose: "archetype" },
    { budgetOwner: "organization", workPurpose: "shared-platform" },
    { budgetOwner: "founder", workPurpose: "archetype" },
  ] as const)("does not spend another purpose under founder platform priorities: %j", scope => {
    expect(resolveDevelopmentInvestmentTarget(scope)).toEqual({ refactorPercent: 20, newWorkPercent: 80 });
  });
  it.each([
    { budgetOwner: null, workPurpose: "shared-platform" },
    { budgetOwner: "founder", workPurpose: null },
  ] as const)("leaves unresolved funding scope unresolved: %j", scope => {
    expect(resolveDevelopmentInvestmentTarget(scope)).toBeNull();
  });
});
