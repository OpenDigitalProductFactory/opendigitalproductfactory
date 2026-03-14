import { describe, expect, it } from "vitest";

import { vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({
  can: vi.fn(),
}));

vi.mock("@/lib/principal-context", () => ({
  buildPrincipalContext: vi.fn(),
}));

vi.mock("@/lib/governance-data", () => ({
  getAgentGovernance: vi.fn(),
  getUserTeamIds: vi.fn(),
  createAuthorizationDecisionLog: vi.fn(),
}));

vi.mock("@/lib/governance-resolver", () => ({
  resolveGovernedAction: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    delegationGrant: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    agent: { findUnique: vi.fn() },
    agentCapabilityClass: { findUnique: vi.fn() },
    directivePolicyClass: { findUnique: vi.fn() },
    agentGovernanceProfile: { upsert: vi.fn() },
    agentOwnership: { upsert: vi.fn() },
    team: { findUnique: vi.fn() },
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { validateDelegationGrantInput } from "./governance";

describe("validateDelegationGrantInput", () => {
  it("rejects expiry before validFrom", () => {
    expect(
      validateDelegationGrantInput({
        granteeAgentId: "AGT-100",
        riskBand: "high",
        validFrom: new Date("2026-03-13T10:00:00Z"),
        expiresAt: new Date("2026-03-13T09:00:00Z"),
        scope: {
          actionFamilies: ["user.lifecycle.update"],
          resourceTypes: ["user"],
          maxRiskBand: "high",
        },
      }),
    ).toMatch(/expiry/i);
  });
});
