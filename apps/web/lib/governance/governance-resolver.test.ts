import { describe, expect, it } from "vitest";
import { resolveGovernedAction } from "./governance-resolver";

describe("resolveGovernedAction", () => {
  it("allows when human role and agent baseline both permit the action", () => {
    const result = resolveGovernedAction({
      humanAllowed: true,
      agentPolicyAllowed: true,
      riskBand: "medium",
      agentMaxRiskBand: "high",
      activeGrant: null,
    });

    expect(result.decision).toBe("allow");
    expect(result.rationaleCode).toBe("baseline_intersection");
  });

  it("requires approval when request exceeds baseline but grant is possible", () => {
    const result = resolveGovernedAction({
      humanAllowed: true,
      agentPolicyAllowed: true,
      riskBand: "critical",
      agentMaxRiskBand: "high",
      activeGrant: null,
    });

    expect(result.decision).toBe("require_approval");
    expect(result.rationaleCode).toBe("grant_required");
  });

  it("denies when risk band exceeds both baseline and grant cap", () => {
    const result = resolveGovernedAction({
      humanAllowed: true,
      agentPolicyAllowed: true,
      riskBand: "critical",
      agentMaxRiskBand: "high",
      activeGrant: {
        maxRiskBand: "high",
        allowsRequestedScope: true,
        expiresAt: new Date("2099-03-13T12:00:00Z"),
        now: new Date("2099-03-13T11:00:00Z"),
      },
    });

    expect(result.decision).toBe("deny");
    expect(result.rationaleCode).toBe("grant_risk_exceeded");
  });

  it("allows when a valid grant extends the agent to the requested scope", () => {
    const result = resolveGovernedAction({
      humanAllowed: true,
      agentPolicyAllowed: true,
      riskBand: "high",
      agentMaxRiskBand: "medium",
      activeGrant: {
        maxRiskBand: "high",
        allowsRequestedScope: true,
        expiresAt: new Date("2099-03-13T12:00:00Z"),
        now: new Date("2099-03-13T11:00:00Z"),
      },
    });

    expect(result.decision).toBe("allow");
    expect(result.rationaleCode).toBe("delegation_grant");
  });
});
