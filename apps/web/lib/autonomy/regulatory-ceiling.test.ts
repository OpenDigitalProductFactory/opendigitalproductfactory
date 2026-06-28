import { describe, expect, it } from "vitest";

import { resolveRegulatoryAutonomyCeiling, type RegulatoryAutonomyPolicyRecord } from "./regulatory-ceiling";

const emptyProfile = {
  operatesIn: [],
  sellsTo: [],
  employsIn: [],
  dataResidency: [],
};

function policy(overrides: Partial<RegulatoryAutonomyPolicyRecord>): RegulatoryAutonomyPolicyRecord {
  return {
    policyId: "RAP-1",
    policyKey: "healthcare-eu-patient-message",
    version: 1,
    status: "active",
    industry: "healthcare-provider",
    jurisdiction: "eu",
    jurisdictionBasis: "operating",
    activityClass: "patient-message.send",
    maxAutonomyLevel: "propose",
    humanControlRequired: true,
    requiredEvidence: ["human-approval"],
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveUntil: null,
    ...overrides,
  };
}

describe("resolveRegulatoryAutonomyCeiling", () => {
  it("defaults unknown policy state to human-controlled propose", () => {
    const result = resolveRegulatoryAutonomyCeiling({
      policies: [],
      profile: { ...emptyProfile, operatesIn: ["eu"] },
      industry: "healthcare-provider",
      activityClass: "patient-message.send",
      asOf: "2026-06-28T12:00:00.000Z",
    });

    expect(result.ceiling).toBe("propose");
    expect(result.defaulted).toBe(true);
    expect(result.humanControlRequired).toBe(true);
    expect(result.requiredEvidence).toContain("operator-policy-review");
    expect(result.reason).toMatch(/No active regulatory autonomy policy/);
  });

  it("matches industry, activity, and jurisdiction basis", () => {
    const result = resolveRegulatoryAutonomyCeiling({
      policies: [policy({})],
      profile: { ...emptyProfile, operatesIn: ["eu"] },
      industry: "healthcare-provider",
      activityClass: "patient-message.send",
      asOf: "2026-06-28T12:00:00.000Z",
    });

    expect(result.ceiling).toBe("propose");
    expect(result.defaulted).toBe(false);
    expect(result.humanControlRequired).toBe(true);
    expect(result.requiredEvidence).toEqual(["human-approval"]);
    expect(result.matchedPolicies.map((p) => p.policyId)).toEqual(["RAP-1"]);
    expect(result.matchedBasis).toEqual(["operating"]);
  });

  it("chooses the most restrictive ceiling and deduplicates evidence across matching policies", () => {
    const result = resolveRegulatoryAutonomyCeiling({
      policies: [
        policy({
          policyId: "RAP-GLOBAL",
          policyKey: "global-patient-message",
          industry: null,
          jurisdiction: "global",
          jurisdictionBasis: "global",
          activityClass: "*",
          maxAutonomyLevel: "autopilot",
          humanControlRequired: false,
          requiredEvidence: ["decision-log"],
        }),
        policy({
          policyId: "RAP-EU",
          maxAutonomyLevel: "propose",
          requiredEvidence: ["decision-log", "human-approval"],
        }),
      ],
      profile: { ...emptyProfile, operatesIn: ["eu"] },
      industry: "healthcare-provider",
      activityClass: "patient-message.send",
      asOf: "2026-06-28T12:00:00.000Z",
    });

    expect(result.ceiling).toBe("propose");
    expect(result.humanControlRequired).toBe(true);
    expect(result.requiredEvidence).toEqual(["decision-log", "human-approval"]);
    expect(result.matchedPolicies.map((p) => p.policyId)).toEqual(["RAP-GLOBAL", "RAP-EU"]);
  });

  it("does not match an out-of-scope jurisdiction", () => {
    const result = resolveRegulatoryAutonomyCeiling({
      policies: [policy({})],
      profile: { ...emptyProfile, operatesIn: ["us"] },
      industry: "healthcare-provider",
      activityClass: "patient-message.send",
      asOf: "2026-06-28T12:00:00.000Z",
    });

    expect(result.defaulted).toBe(true);
    expect(result.matchedPolicies).toEqual([]);
  });

  it("treats invalid policy autonomy levels as a human-controlled propose ceiling", () => {
    const result = resolveRegulatoryAutonomyCeiling({
      policies: [
        policy({
          maxAutonomyLevel: "unbounded" as never,
          humanControlRequired: false,
          requiredEvidence: [],
        }),
      ],
      profile: { ...emptyProfile, operatesIn: ["eu"] },
      industry: "healthcare-provider",
      activityClass: "patient-message.send",
      asOf: "2026-06-28T12:00:00.000Z",
    });

    expect(result.ceiling).toBe("propose");
    expect(result.humanControlRequired).toBe(true);
    expect(result.requiredEvidence).toContain("operator-policy-review");
  });
});
