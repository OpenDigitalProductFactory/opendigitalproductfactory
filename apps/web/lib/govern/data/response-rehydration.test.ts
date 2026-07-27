import { describe, expect, it } from "vitest";

import type { EffectiveAuthContext } from "@/lib/identity/effective-auth-context";

import {
  createRehydrationToken,
  storeRehydrationTokenMap,
  type RehydrationAuthorizationBinding,
} from "./rehydration-token-vault";
import { rehydrateResponse } from "./response-rehydration";

const versions = {
  assetVersion: "asset-v1",
  classificationVersion: "classification-v1",
  authorityVersion: "authority-v1",
};

const managerContext: EffectiveAuthContext = {
  principalId: "PRN-manager",
  principalAliases: [],
  population: "workforce",
  platformRole: "HR-100",
  isSuperuser: false,
  employeeId: "emp-manager",
  managerScope: {
    directReportIds: ["emp-direct"],
    indirectReportIds: ["emp-indirect"],
  },
  teamIds: ["team-a"],
  accountScope: {
    accountIds: [],
    contactIds: [],
    partnerAccountIds: [],
  },
  sensitivityClearance: ["public", "confidential"],
  authentication: {
    source: "session",
    methods: ["pwd"],
    contextClassReference: null,
  },
  actingHumanUserId: "user-manager",
  actingAgentId: null,
  delegationGrantIds: [],
  grantedCapabilities: ["view_employee"],
};

function employeeBinding(
  employeeId: string,
  overrides: Partial<RehydrationAuthorizationBinding> = {},
): RehydrationAuthorizationBinding {
  return {
    expectedActor: {
      principalId: "PRN-manager",
      actingHumanUserId: "user-manager",
      actingAgentId: null,
      delegationGrantId: null,
    },
    purpose: "coworker-assistance",
    surface: "private-employee",
    subject: { kind: "employee", id: employeeId },
    sensitivity: "confidential",
    decisionVersions: [{
      decisionId: "ddp_employee",
      ...versions,
    }],
    dataClasses: ["employee-records"],
    ...overrides,
  };
}

function vault(
  entries: Array<{ raw: string; binding?: RehydrationAuthorizationBinding }>,
  now = 1_000,
) {
  const tokens = new Map(
    entries.map(({ raw, binding }) => [
      createRehydrationToken(raw),
      {
        value: raw,
        bindings: binding ? [binding] : [],
      },
    ]),
  );
  return {
    handle: storeRehydrationTokenMap(tokens, { now }),
    tokens: entries.map(({ raw }) => createRehydrationToken(raw)),
  };
}

describe("response rehydration PEP", () => {
  it.each(["emp-direct", "emp-indirect"])(
    "allows a cleared manager to receive authorized detail for %s",
    (employeeId) => {
      const raw = `${employeeId}@example.com`;
      const stored = vault([{ raw, binding: employeeBinding(employeeId) }]);

      const result = rehydrateResponse({
        value: `Contact ${stored.tokens[0]}`,
        rehydrationHandle: stored.handle,
        authContext: managerContext,
        purpose: "coworker-assistance",
        surface: "private-employee",
        currentVersions: versions,
        now: 1_001,
      });

      expect(result.value).toBe(`Contact ${raw}`);
      expect(result.evidence).toEqual({
        outcome: "rehydrated",
        authorizedTokenCount: 1,
        deniedTokenCount: 0,
        explanationCodes: ["response-rehydration-authorized"],
        rawValuesStored: false,
      });
    },
  );

  it("keeps peer and unrelated employee details tokenized", () => {
    const raw = "peer@example.com";
    const stored = vault([{ raw, binding: employeeBinding("emp-peer") }]);

    const result = rehydrateResponse({
      value: stored.tokens[0],
      rehydrationHandle: stored.handle,
      authContext: managerContext,
      purpose: "coworker-assistance",
      surface: "private-employee",
      currentVersions: versions,
      now: 1_001,
    });

    expect(result.value).toBe(stored.tokens[0]);
    expect(result.evidence.outcome).toBe("masked");
    expect(result.evidence.explanationCodes).toContain("response-subject-not-authorized");
  });

  it("denies shared surfaces even when the viewer can access the employee directly", () => {
    const raw = "direct@example.com";
    const stored = vault([{ raw, binding: employeeBinding("emp-direct") }]);

    const result = rehydrateResponse({
      value: stored.tokens[0],
      rehydrationHandle: stored.handle,
      authContext: managerContext,
      purpose: "coworker-assistance",
      surface: "shared-team",
      currentVersions: versions,
      now: 1_001,
    });

    expect(result.value).toBe(stored.tokens[0]);
    expect(result.evidence.explanationCodes).toContain("response-surface-not-authorized");
  });

  it("rehydrates mixed output token by token without one allow unlocking a sibling", () => {
    const allowedRaw = "direct@example.com";
    const deniedRaw = "peer@example.com";
    const stored = vault([
      { raw: allowedRaw, binding: employeeBinding("emp-direct") },
      { raw: deniedRaw, binding: employeeBinding("emp-peer") },
    ]);
    const value = {
      allowed: `${stored.tokens[0]} / ${stored.tokens[0]}`,
      denied: stored.tokens[1],
    };

    const result = rehydrateResponse({
      value,
      rehydrationHandle: stored.handle,
      authContext: managerContext,
      purpose: "coworker-assistance",
      surface: "private-employee",
      currentVersions: versions,
      now: 1_001,
    });

    expect(result.value).toEqual({
      allowed: `${allowedRaw} / ${allowedRaw}`,
      denied: stored.tokens[1],
    });
    expect(result.evidence).toMatchObject({
      outcome: "partially-rehydrated",
      authorizedTokenCount: 1,
      deniedTokenCount: 1,
    });
  });

  it.each([
    {
      name: "insufficient clearance",
      authContext: { ...managerContext, sensitivityClearance: ["public"] as const },
      currentVersions: versions,
      purpose: "coworker-assistance" as const,
      surface: "private-employee" as const,
      explanation: "response-clearance-insufficient",
    },
    {
      name: "policy-version drift",
      authContext: managerContext,
      currentVersions: { ...versions, authorityVersion: "authority-v2" },
      purpose: "coworker-assistance" as const,
      surface: "private-employee" as const,
      explanation: "response-policy-version-stale",
    },
    {
      name: "purpose mismatch",
      authContext: managerContext,
      currentVersions: versions,
      purpose: "platform-operations" as const,
      surface: "private-employee" as const,
      explanation: "response-purpose-not-authorized",
    },
  ])("fails closed for $name", (scenario) => {
    const raw = "direct@example.com";
    const stored = vault([{ raw, binding: employeeBinding("emp-direct") }]);

    const result = rehydrateResponse({
      value: stored.tokens[0],
      rehydrationHandle: stored.handle,
      authContext: scenario.authContext as EffectiveAuthContext,
      purpose: scenario.purpose,
      surface: scenario.surface,
      currentVersions: scenario.currentVersions,
      now: 1_001,
    });

    expect(result.value).toBe(stored.tokens[0]);
    expect(result.evidence.explanationCodes).toContain(scenario.explanation);
  });

  it("requires matching acting-agent and active delegation evidence", () => {
    const raw = "direct@example.com";
    const binding = employeeBinding("emp-direct", {
      expectedActor: {
        principalId: "PRN-manager",
        actingHumanUserId: "user-manager",
        actingAgentId: "AGT-1",
        delegationGrantId: "DGR-1",
      },
    });
    const stored = vault([{ raw, binding }]);
    const agentContext: EffectiveAuthContext = {
      ...managerContext,
      population: "ai-coworker",
      actingAgentId: "AGT-1",
      delegationGrantIds: [],
    };

    const result = rehydrateResponse({
      value: stored.tokens[0],
      rehydrationHandle: stored.handle,
      authContext: agentContext,
      purpose: "coworker-assistance",
      surface: "private-employee",
      currentVersions: versions,
      now: 1_001,
    });

    expect(result.value).toBe(stored.tokens[0]);
    expect(result.evidence.explanationCodes).toContain("response-delegation-not-authorized");
  });

  it("requires the authenticated customer account scope for customer detail", () => {
    const raw = "customer@example.com";
    const stored = vault([{
      raw,
      binding: employeeBinding("unused", {
        purpose: "customer-support",
        surface: "private-customer",
        subject: { kind: "account", id: "account-allowed" },
        dataClasses: ["customer-records"],
      }),
    }]);
    const customerContext: EffectiveAuthContext = {
      ...managerContext,
      population: "customer",
      employeeId: null,
      managerScope: null,
      accountScope: {
        accountIds: ["account-other"],
        contactIds: [],
        partnerAccountIds: [],
      },
      grantedCapabilities: [],
    };

    const result = rehydrateResponse({
      value: stored.tokens[0],
      rehydrationHandle: stored.handle,
      authContext: customerContext,
      purpose: "customer-support",
      surface: "private-customer",
      currentVersions: versions,
      now: 1_001,
    });

    expect(result.value).toBe(stored.tokens[0]);
    expect(result.evidence.explanationCodes).toContain("response-subject-not-authorized");
  });

  it("preserves unknown and malformed token text without treating it as vault evidence", () => {
    const stored = vault([{
      raw: "direct@example.com",
      binding: employeeBinding("emp-direct"),
    }]);
    const value = `${stored.tokens[0]} [DPF_TOKEN_NOT_A_TOKEN]`;

    const result = rehydrateResponse({
      value,
      rehydrationHandle: stored.handle,
      authContext: managerContext,
      purpose: "coworker-assistance",
      surface: "private-employee",
      currentVersions: versions,
      now: 1_001,
    });

    expect(result.value).toBe("direct@example.com [DPF_TOKEN_NOT_A_TOKEN]");
    expect(result.evidence.authorizedTokenCount).toBe(1);
  });

  it("treats missing, expired, and unbound vault state identically and leaks no raw value", () => {
    const raw = "never-log@example.com";
    const unbound = vault([{ raw }], 2_000);
    const expired = rehydrateResponse({
      value: unbound.tokens[0],
      rehydrationHandle: unbound.handle,
      authContext: managerContext,
      purpose: "coworker-assistance",
      surface: "private-employee",
      currentVersions: versions,
      now: 2_000 + 5 * 60_000 + 1,
    });

    expect(expired.value).toBe(unbound.tokens[0]);
    expect(JSON.stringify(expired.evidence)).not.toContain(raw);
    expect(JSON.stringify(expired.evidence)).not.toContain(unbound.handle);

    const missing = rehydrateResponse({
      value: unbound.tokens[0],
      rehydrationHandle: "rehydration_missing",
      authContext: managerContext,
      purpose: "coworker-assistance",
      surface: "private-employee",
      currentVersions: versions,
      now: 2_001,
    });
    expect(missing.evidence).toEqual(expired.evidence);

    const unboundResult = rehydrateResponse({
      value: unbound.tokens[0],
      rehydrationHandle: unbound.handle,
      authContext: managerContext,
      purpose: "coworker-assistance",
      surface: "private-employee",
      currentVersions: versions,
      now: 2_001,
    });
    expect(unboundResult.evidence).toEqual(expired.evidence);
  });
});
