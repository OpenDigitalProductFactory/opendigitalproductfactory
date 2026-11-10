import { describe, expect, it } from "vitest";
import { accountCapacityScope, conservativeQuotaScope, isAccountCapacityState } from "./scopes";

describe("capacity ownership", () => {
  it("keeps consumer aliases in one conservative quota budget", () => {
    expect(conservativeQuotaScope("chatgpt")).toBe(conservativeQuotaScope("codex"));
    expect(conservativeQuotaScope("openai")).not.toBe(conservativeQuotaScope("codex"));
  });
  it("keeps sibling authentication health separate without exposing identity labels", () => {
    expect(accountCapacityScope("openai", "account-a")).not.toBe(accountCapacityScope("openai", "account-b"));
    expect(accountCapacityScope("openai", "account-a")).not.toContain("account-a");
  });
  it("does not infer independent quota from distinct credentials", () => {
    expect(conservativeQuotaScope("openai")).toBe("provider:openai");
    expect(isAccountCapacityState("reauth_required")).toBe(true);
    expect(isAccountCapacityState("quota_resets_at")).toBe(false);
  });
});
