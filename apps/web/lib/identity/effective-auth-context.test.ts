import { describe, expect, it } from "vitest";

import { buildEffectiveAuthContext } from "./effective-auth-context";

describe("buildEffectiveAuthContext", () => {
  it("builds effective auth context for a workforce user", () => {
    const context = buildEffectiveAuthContext({
      user: {
        id: "user-1",
        type: "admin",
        platformRole: "HR-300",
        isSuperuser: false,
      },
      grantedCapabilities: ["view_admin", "view_employee"],
      employeeProfile: {
        id: "emp-1",
        directReports: [],
      },
    });

    expect(context.principalId).toBe("PRN-USER-user-1");
    expect(context.platformRole).toBe("HR-300");
    expect(context.employeeId).toBe("emp-1");
    expect(context.grantedCapabilities).toEqual(["view_admin", "view_employee"]);
  });

  it("returns empty manager scope for a non-manager", () => {
    const context = buildEffectiveAuthContext({
      user: {
        id: "user-2",
        type: "admin",
        platformRole: "HR-100",
        isSuperuser: false,
      },
      grantedCapabilities: ["view_self"],
      employeeProfile: {
        id: "emp-2",
        directReports: [],
      },
    });

    expect(context.managerScope?.directReportIds ?? []).toEqual([]);
  });
});
