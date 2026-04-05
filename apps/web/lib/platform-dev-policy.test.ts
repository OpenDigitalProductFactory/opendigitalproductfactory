import { describe, expect, it } from "vitest";

import { getPlatformDevPolicyState } from "./platform-dev-policy";

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
