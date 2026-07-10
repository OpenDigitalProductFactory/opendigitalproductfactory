import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  departmentFindFirst: vi.fn(),
  departmentFindMany: vi.fn(),
  positionFindMany: vi.fn(),
  positionFindFirst: vi.fn(),
  employeeFindMany: vi.fn(),
  employeeFindFirst: vi.fn(),
  employeeFindUnique: vi.fn(),
  employeeCreate: vi.fn(),
  employeeUpdate: vi.fn(),
  employmentEventCreate: vi.fn(),
  leavePolicyCreate: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("@dpf/db", () => ({
  prisma: {
    department: {
      findFirst: (...a: unknown[]) => db.departmentFindFirst(...a),
      findMany: (...a: unknown[]) => db.departmentFindMany(...a),
    },
    position: {
      findMany: (...a: unknown[]) => db.positionFindMany(...a),
      findFirst: (...a: unknown[]) => db.positionFindFirst(...a),
    },
    employeeProfile: {
      findMany: (...a: unknown[]) => db.employeeFindMany(...a),
      findFirst: (...a: unknown[]) => db.employeeFindFirst(...a),
      findUnique: (...a: unknown[]) => db.employeeFindUnique(...a),
      create: (...a: unknown[]) => db.employeeCreate(...a),
      update: (...a: unknown[]) => db.employeeUpdate(...a),
    },
    employmentEvent: { create: (...a: unknown[]) => db.employmentEventCreate(...a) },
    leavePolicy: { create: (...a: unknown[]) => db.leavePolicyCreate(...a) },
    $transaction: (...a: unknown[]) => db.transaction(...a),
  },
}));

import { workforcePack } from "./workforce-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

const EXPECTED_TOOLS = [
  "query_employees",
  "list_departments",
  "list_positions",
  "create_employee",
  "transition_employee_status",
  "propose_leave_policy",
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("workforce pack — registration", () => {
  it("exposes exactly the six workforce tools with a handler each", () => {
    expect(workforcePack.definitions.map((d) => d.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(Object.keys(workforcePack.handlers).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it("descriptions are provenance-free (no BI/Phase/EP/path leakage)", () => {
    for (const d of workforcePack.definitions) {
      expect(d.description).not.toMatch(/\bBI-|Phase \d|EP-|apps\/web\//);
    }
  });

  it("grants mirror agent-grants: read tools need read grants, mutating tools need write grants", () => {
    expect(workforcePack.grants.query_employees).toEqual(["consumer_read", "registry_read"]);
    expect(workforcePack.grants.list_departments).toEqual(["registry_read"]);
    expect(workforcePack.grants.list_positions).toEqual(["registry_read"]);
    expect(workforcePack.grants.create_employee).toEqual(["consumer_write"]);
    expect(workforcePack.grants.transition_employee_status).toEqual(["consumer_write"]);
    expect(workforcePack.grants.propose_leave_policy).toEqual(["policy_write"]);

    expect(isToolAllowedByGrants("query_employees", ["consumer_read"])).toBe(true);
    expect(isToolAllowedByGrants("list_departments", ["registry_read"])).toBe(true);
    expect(isToolAllowedByGrants("create_employee", ["consumer_write"])).toBe(true);
    expect(isToolAllowedByGrants("transition_employee_status", ["consumer_write"])).toBe(true);
    expect(isToolAllowedByGrants("propose_leave_policy", ["policy_write"])).toBe(true);
  });
});

describe("workforce pack — handler behavior (delegation preserved)", () => {
  it("list_departments reports the empty state when none exist", async () => {
    db.departmentFindMany.mockResolvedValue([]);
    const res = await workforcePack.handlers.list_departments({}, "u1");
    expect(res.success).toBe(true);
    expect(res.message).toContain("No departments have been set up yet.");
    expect(res.data).toEqual({ departments: [] });
  });

  it("list_positions maps active positions to id/title/jobFamily", async () => {
    db.positionFindMany.mockResolvedValue([{ positionId: "POS-1", title: "Engineer", jobFamily: "Tech" }]);
    const res = await workforcePack.handlers.list_positions({}, "u1");
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ positions: [{ id: "POS-1", title: "Engineer", jobFamily: "Tech" }] });
  });

  it("query_employees reports the empty state when none match", async () => {
    db.employeeFindMany.mockResolvedValue([]);
    const res = await workforcePack.handlers.query_employees({ search: "nobody" }, "u1");
    expect(res.success).toBe(true);
    expect(res.message).toContain("No employees found matching your criteria.");
    expect(db.employeeFindMany).toHaveBeenCalledOnce();
  });

  it("create_employee rejects a duplicate work email without creating", async () => {
    db.employeeFindFirst.mockResolvedValue({ displayName: "Ada Byron", employeeId: "EMP-EXIST" });
    const res = await workforcePack.handlers.create_employee(
      { firstName: "Ada", lastName: "Byron", workEmail: "ada@example.com" },
      "u1",
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("duplicate_email");
    expect(db.employeeCreate).not.toHaveBeenCalled();
  });

  it("create_employee creates a profile and threads the acting user into the employment event", async () => {
    db.employeeFindFirst.mockResolvedValue(null);
    db.employeeCreate.mockResolvedValue({ employeeId: "EMP-NEW", displayName: "Grace Hopper" });
    const res = await workforcePack.handlers.create_employee(
      { firstName: "Grace", lastName: "Hopper", status: "active" },
      "actor-42",
    );
    expect(res.success).toBe(true);
    expect(res.entityId).toBe("EMP-NEW");
    const arg = db.employeeCreate.mock.calls[0][0] as { data: { status: string; employmentEvents: { create: { actorUserId: string } } } };
    expect(arg.data.status).toBe("active");
    expect(arg.data.employmentEvents.create.actorUserId).toBe("actor-42");
  });

  it("transition_employee_status errors when the employee is not found", async () => {
    db.employeeFindUnique.mockResolvedValue(null);
    const res = await workforcePack.handlers.transition_employee_status(
      { employeeId: "EMP-GHOST", newStatus: "active" },
      "u1",
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("Employee not found");
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("propose_leave_policy rejects a non-array policies input", async () => {
    const res = await workforcePack.handlers.propose_leave_policy(
      { locationContext: "US", policies: "not-an-array" },
      "u1",
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("No policies provided");
    expect(db.leavePolicyCreate).not.toHaveBeenCalled();
  });

  it("propose_leave_policy creates each supplied default policy", async () => {
    db.leavePolicyCreate.mockResolvedValue({});
    const res = await workforcePack.handlers.propose_leave_policy(
      {
        locationContext: "US",
        policies: [
          { leaveType: "annual", name: "Annual Leave", annualAllocation: 20 },
          { leaveType: "sick", name: "Sick Leave", annualAllocation: 10, carryoverLimit: 5 },
        ],
      },
      "u1",
    );
    expect(res.success).toBe(true);
    expect(db.leavePolicyCreate).toHaveBeenCalledTimes(2);
  });
});
