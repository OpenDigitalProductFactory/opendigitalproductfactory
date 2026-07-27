import { describe, expect, it } from "vitest";

import type { EffectiveAuthContext } from "@/lib/identity/effective-auth-context";

import { canAccessEmployeeScope } from "./manager-scope";

describe("canAccessEmployeeScope", () => {
  const managerContext = {
    principalId: "PRN-USER-user-1",
    platformRole: "HR-100",
    isSuperuser: false,
    employeeId: "emp-manager",
    managerScope: {
      directReportIds: ["emp-report-1", "emp-report-2"],
      indirectReportIds: ["emp-indirect"],
    },
    principalAliases: [],
    population: "workforce" as const,
    teamIds: ["team-1"],
    accountScope: { accountIds: [], contactIds: [], partnerAccountIds: [] },
    sensitivityClearance: ["public"],
    authentication: {
      source: "session" as const,
      methods: [],
      contextClassReference: null,
    },
    actingHumanUserId: "user-1",
    actingAgentId: null,
    delegationGrantIds: [],
    grantedCapabilities: ["view_employee"],
  } satisfies EffectiveAuthContext;

  it("allows a manager to access a direct report", () => {
    expect(canAccessEmployeeScope(managerContext, "emp-report-1")).toBe(true);
  });

  it("denies a manager access to unrelated employees without HR capability", () => {
    expect(canAccessEmployeeScope(managerContext, "emp-other")).toBe(false);
  });

  it("does not widen employee access merely because a peer shares the team", () => {
    expect(canAccessEmployeeScope(managerContext, "emp-team-peer")).toBe(false);
  });

  it("allows a manager to access an indirect report", () => {
    expect(canAccessEmployeeScope(managerContext, "emp-indirect")).toBe(true);
  });

  it("allows self access", () => {
    expect(canAccessEmployeeScope(managerContext, "emp-manager")).toBe(true);
  });

  it("allows superusers regardless of reporting chain", () => {
    expect(
      canAccessEmployeeScope(
        {
          ...managerContext,
          isSuperuser: true,
        },
        "emp-anyone",
      ),
    ).toBe(true);
  });
});
