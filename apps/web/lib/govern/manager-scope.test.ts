import { describe, expect, it } from "vitest";

import { canAccessEmployeeScope } from "./manager-scope";

describe("canAccessEmployeeScope", () => {
  const managerContext = {
    principalId: "PRN-USER-user-1",
    platformRole: "HR-100",
    isSuperuser: false,
    employeeId: "emp-manager",
    managerScope: {
      directReportIds: ["emp-report-1", "emp-report-2"],
      indirectReportIds: [],
    },
    grantedCapabilities: ["view_employee"],
  };

  it("allows a manager to access a direct report", () => {
    expect(canAccessEmployeeScope(managerContext, "emp-report-1")).toBe(true);
  });

  it("denies a manager access to unrelated employees without HR capability", () => {
    expect(canAccessEmployeeScope(managerContext, "emp-other")).toBe(false);
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
