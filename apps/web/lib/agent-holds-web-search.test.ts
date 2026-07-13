import { describe, expect, it } from "vitest";
import { agentHoldsWebSearchGrant } from "./tak/agent-web-search-grant";

describe("agentHoldsWebSearchGrant (BI-CD9DC3BC)", () => {
  it("is true for outward research roles and false for no-web governance roles", () => {
    expect(agentHoldsWebSearchGrant("marketing-specialist")).toBe(true);
    expect(agentHoldsWebSearchGrant("customer-advisor")).toBe(true);
    expect(agentHoldsWebSearchGrant("data-governance-agent")).toBe(false);
    expect(agentHoldsWebSearchGrant("soc-triage-analyst")).toBe(false);
    expect(agentHoldsWebSearchGrant(null)).toBe(false);
  });
});
