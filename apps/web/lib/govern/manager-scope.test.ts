import { describe, expect, it } from "vitest";

import type { EffectiveAuthContext } from "@/lib/identity/effective-auth-context";

import { canAccessEmployeeScope, employeeScopeVisibleIds } from "./manager-scope";

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

  describe("employeeScopeVisibleIds", () => {
    it("is unrestricted for a superuser (sees every employee)", () => {
      const scope = employeeScopeVisibleIds({ ...managerContext, isSuperuser: true });
      expect(scope.unrestricted).toBe(true);
    });

    it("returns self ∪ direct ∪ indirect reports for a manager", () => {
      const scope = employeeScopeVisibleIds(managerContext);
      expect(scope.unrestricted).toBe(false);
      expect([...scope.visibleProfileIds].sort()).toEqual(
        ["emp-indirect", "emp-manager", "emp-report-1", "emp-report-2"].sort(),
      );
    });

    it("is empty when the principal is neither an employee nor a manager", () => {
      const scope = employeeScopeVisibleIds({
        isSuperuser: false,
        employeeId: null,
        managerScope: null,
      });
      expect(scope).toEqual({ unrestricted: false, visibleProfileIds: [] });
    });

    // The load-bearing invariant: the visible set is EXACTLY the set of ids for
    // which canAccessEmployeeScope is true, so a list filtered by it can never
    // leak an employee the caller could not open individually.
    it("is the exact row-level dual of canAccessEmployeeScope", () => {
      const scope = employeeScopeVisibleIds(managerContext);
      const candidates = [
        "emp-manager",
        "emp-report-1",
        "emp-report-2",
        "emp-indirect",
        "emp-other",
        "emp-team-peer",
      ];
      for (const id of candidates) {
        expect(scope.visibleProfileIds.includes(id)).toBe(
          canAccessEmployeeScope(managerContext, id),
        );
      }
    });
  });
});
