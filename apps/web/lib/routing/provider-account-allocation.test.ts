import { describe, expect, it } from "vitest";
import { compareAccountAllocation, rememberAccountAffinity, reserveProviderAccount } from "./provider-account-allocation";

const account = (providerConnectionId: string) => ({ providerId: "openai", providerConnectionId });
describe("eligible account allocation", () => {
  it("prefers an idle sibling while a request is in flight and releases once", () => {
    const release = reserveProviderAccount(account("allocation-a"));
    expect(compareAccountAllocation(account("allocation-a"), account("allocation-b"))).toBeGreaterThan(0);
    release(); release();
    expect(compareAccountAllocation(account("allocation-a"), account("allocation-b"))).toBe(0);
  });
  it("keeps task affinity among already eligible siblings and expires it", () => {
    rememberAccountAffinity("task-fixture", account("affinity-b"), 1000);
    expect(compareAccountAllocation(account("affinity-a"), account("affinity-b"), "task-fixture", 1001)).toBeGreaterThan(0);
    expect(compareAccountAllocation(account("affinity-a"), account("affinity-b"), "task-fixture", 3_601_001)).toBe(0);
  });
});
