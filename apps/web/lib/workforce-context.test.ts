import { describe, expect, it } from "vitest";
import { buildWorkforceContext } from "./workforce-context";

describe("buildWorkforceContext", () => {
  it("maps an employee profile into a stable runtime shape", () => {
    const ctx = buildWorkforceContext({
      employeeId: "EMP-001",
      departmentId: "dept-people",
      managerEmployeeId: "EMP-002",
      status: "active",
      workLocationId: "loc-remote",
      timezone: "America/Chicago",
    });

    expect(ctx.employeeId).toBe("EMP-001");
    expect(ctx.departmentId).toBe("dept-people");
    expect(ctx.employmentStatus).toBe("active");
  });
});
