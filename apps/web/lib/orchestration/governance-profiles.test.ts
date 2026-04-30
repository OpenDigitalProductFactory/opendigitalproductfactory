// apps/web/lib/orchestration/governance-profiles.test.ts

import { describe, expect, it } from "vitest";
import {
  GOVERNANCE_PROFILES,
  resolveBudget,
  deriveGovernanceProfile,
} from "./governance-profiles";
import type { GovernanceProfile } from "./types";

describe("GOVERNANCE_PROFILES", () => {
  it("every profile has positive maxAttempts/deadlineMs/heartbeatMs", () => {
    for (const [slug, budget] of Object.entries(GOVERNANCE_PROFILES)) {
      expect(budget.maxAttempts, `${slug}.maxAttempts`).toBeGreaterThan(0);
      expect(budget.deadlineMs, `${slug}.deadlineMs`).toBeGreaterThan(0);
      expect(budget.heartbeatMs, `${slug}.heartbeatMs`).toBeGreaterThan(0);
    }
  });

  it("system.tokenBudget is intentionally 0 (infra polling, not model calls)", () => {
    expect(GOVERNANCE_PROFILES.system.tokenBudget).toBe(0);
  });

  it("non-system profiles have positive tokenBudget", () => {
    const nonSystem: GovernanceProfile[] = [
      "economy",
      "balanced",
      "high-assurance",
      "document-authority",
    ];
    for (const slug of nonSystem) {
      expect(GOVERNANCE_PROFILES[slug].tokenBudget, `${slug}.tokenBudget`).toBeGreaterThan(0);
    }
  });
});

describe("deriveGovernanceProfile", () => {
  it("hitlPolicy 'always' → high-assurance regardless of autonomyLevel", () => {
    expect(
      deriveGovernanceProfile({ hitlPolicy: "always", autonomyLevel: "autonomous" }),
    ).toBe("high-assurance");
  });

  it("autonomyLevel 'supervised' → high-assurance", () => {
    expect(
      deriveGovernanceProfile({ hitlPolicy: "never", autonomyLevel: "supervised" }),
    ).toBe("high-assurance");
  });

  it("autonomyLevel 'constrained' → balanced", () => {
    expect(
      deriveGovernanceProfile({ hitlPolicy: "never", autonomyLevel: "constrained" }),
    ).toBe("balanced");
  });

  it("autonomyLevel 'autonomous' + maxDelegationRiskBand 'low' → economy", () => {
    expect(
      deriveGovernanceProfile({
        hitlPolicy: "never",
        autonomyLevel: "autonomous",
        maxDelegationRiskBand: "low",
      }),
    ).toBe("economy");
  });

  it("falls through to balanced for unrecognized combinations", () => {
    expect(
      deriveGovernanceProfile({
        hitlPolicy: "never",
        autonomyLevel: "autonomous",
        maxDelegationRiskBand: "high",
      }),
    ).toBe("balanced");
  });
});

describe("resolveBudget", () => {
  it("returns the registry entry for a known profile", () => {
    const budget = resolveBudget({
      runId: "r1",
      userId: "u1",
      governanceProfile: "balanced",
    });
    expect(budget).toBe(GOVERNANCE_PROFILES.balanced);
  });

  it("throws synchronously when the profile slug is not in the registry", () => {
    expect(() =>
      resolveBudget({
        runId: "r1",
        userId: "u1",
        // @ts-expect-error — intentionally invalid slug for the negative test
        governanceProfile: "baalanced",
      }),
    ).toThrow(/unknown governance profile/i);
  });
});
