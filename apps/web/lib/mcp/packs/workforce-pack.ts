// Workforce (HR employee lifecycle) tool pack — BI-ARCH-TOOLPACKS.
//
// Drains the self-contained "workforce" domain out of the mcp-tools.ts
// executeTool switch: the six tools the People/HR co-worker uses to read and
// manage employee records — search employees, list departments and positions,
// create an employee, move an employee through lifecycle stages, and seed
// default leave policies. Each handler lazy-imports the Prisma client and
// reproduces the former switch case verbatim, so behaviour is identical when a
// tool is invoked over MCP.
//
// Definitions moved verbatim out of the inline PLATFORM_TOOLS array; grants
// mirror agent-grants.ts TOOL_TO_GRANTS, which stays the gating source.

import { randomUUID } from "node:crypto";

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import { employeeScopeVisibleIds, type EmployeeVisibilityScope } from "@/lib/govern/manager-scope";
import { resolveManagerScope } from "@/lib/identity/load-effective-auth-context";
import type { ToolPack, ToolPackHandler } from "../tool-pack";

const definitions: ToolDefinition[] = [
  {
    name: "query_employees",
    description: "Search and list employee profiles. Use this to find employees by name, email, department, or status. Returns a summary list with employee IDs, names, and departments. Use before create_employee to check if someone already exists.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Search by name or email (partial match, optional)" },
        department: { type: "string", description: "Filter by department name or ID (optional)" },
        status: { type: "string", enum: ["offer", "onboarding", "active", "leave", "suspended", "offboarding", "inactive"], description: "Filter by employment status (optional)" },
        limit: { type: "number", description: "Max results to return (default 20)" },
      },
    },
    requiredCapability: "view_employee",
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "list_departments",
    description: "List all active departments with their IDs and names. Call this before create_employee to find valid department IDs or to present the user with choices.",
    inputSchema: { type: "object", properties: {} },
    requiredCapability: "view_employee",
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "list_positions",
    description: "List all active positions with their IDs and titles. Call this before create_employee to find valid position IDs or to present the user with choices.",
    inputSchema: { type: "object", properties: {} },
    requiredCapability: "view_employee",
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "create_employee",
    description: "Create a new employee record. Department and position can be supplied as an ID or a name/title — the system resolves names automatically. Call list_departments and list_positions first if you need to show the user their options.",
    inputSchema: {
      type: "object",
      properties: {
        firstName: { type: "string", description: "First name" },
        lastName: { type: "string", description: "Last name" },
        workEmail: { type: "string", description: "Work email address" },
        status: { type: "string", enum: ["offer", "onboarding", "active"], description: "Initial status (default: offer)" },
        departmentId: { type: "string", description: "Department ID or department name (optional)" },
        positionId: { type: "string", description: "Position ID or position title (optional)" },
        managerEmployeeId: { type: "string", description: "Manager employee ID, display name, or email (optional)" },
        startDate: { type: "string", description: "Start date ISO string (optional)" },
      },
      required: ["firstName", "lastName"],
    },
    requiredCapability: "manage_user_lifecycle",
    executionMode: "immediate",
    sideEffect: true,
    // changes identity or authority → consult-gated (TAK §8.4.1).
    consequence: "authority",
  },
  {
    name: "transition_employee_status",
    description: "Move an employee through lifecycle stages (e.g. offer → onboarding, onboarding → active, active → offboarding).",
    inputSchema: {
      type: "object",
      properties: {
        employeeId: { type: "string", description: "Employee ID (e.g. EMP-XXXXX)" },
        newStatus: { type: "string", enum: ["onboarding", "active", "leave", "suspended", "offboarding", "inactive"], description: "Target status" },
        reason: { type: "string", description: "Reason for the transition" },
      },
      required: ["employeeId", "newStatus"],
    },
    requiredCapability: "manage_user_lifecycle",
    executionMode: "immediate",
    sideEffect: true,
    // changes identity or authority → consult-gated (TAK §8.4.1).
    consequence: "authority",
  },
  {
    name: "propose_leave_policy",
    description: "Suggest leave policies for an employee based on their location/country. Creates default leave policy records.",
    inputSchema: {
      type: "object",
      properties: {
        locationContext: { type: "string", description: "Country or region for policy recommendations" },
        policies: {
          type: "array",
          description: "Array of policy suggestions",
          items: {
            type: "object",
            properties: {
              leaveType: { type: "string" },
              name: { type: "string" },
              annualAllocation: { type: "number" },
              carryoverLimit: { type: "number" },
            },
          },
        },
      },
      required: ["locationContext", "policies"],
    },
    requiredCapability: "manage_user_lifecycle",
    executionMode: "immediate",
    sideEffect: true,
  },
];

// Row-scope the employee list to the acting human's manager visibility so an
// agent sees exactly the employees the person could open individually. This is
// the list-time dual of the coworker-authority `subject-scope-denied` gate,
// which already scopes id-addressed employee tools (transition_employee_status,
// etc.) via canAccessEmployeeScope; the list historically bypassed it because
// deriveCoworkerAuthoritySubject resolves a list call to the `platform` subject.
// Superusers stay unrestricted (the installation-owner path). Uses the same
// resolveManagerScope the effective-auth loader uses, so the two never diverge.
async function resolveEmployeeVisibility(userId: string): Promise<EmployeeVisibilityScope> {
  const { prisma } = await import("@dpf/db");
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isSuperuser: true },
  });
  if (user?.isSuperuser) {
    return employeeScopeVisibleIds({ isSuperuser: true, employeeId: null, managerScope: null });
  }
  const employees = await prisma.employeeProfile.findMany({
    select: { id: true, userId: true, managerEmployeeId: true },
  });
  const scope = resolveManagerScope(employees, userId);
  return employeeScopeVisibleIds({
    isSuperuser: false,
    employeeId: scope?.employeeId ?? null,
    managerScope: scope
      ? { directReportIds: scope.directReportIds, indirectReportIds: scope.indirectReportIds }
      : null,
  });
}

async function queryEmployees(params: Record<string, unknown>, userId: string): Promise<ToolResult> {
  const { prisma } = await import("@dpf/db");
  const visibility = await resolveEmployeeVisibility(userId);
  // A scoped caller with no visible employees (not an employee, manages no one)
  // can never match a row — short-circuit before hitting the DB with `id in []`.
  if (!visibility.unrestricted && visibility.visibleProfileIds.length === 0) {
    return { success: true, message: "No employees found matching your criteria.", data: { employees: [] } };
  }
  const searchTerm = typeof params["search"] === "string" ? params["search"].trim() : undefined;
  const deptFilter = typeof params["department"] === "string" ? params["department"].trim() : undefined;
  const statusFilter = typeof params["status"] === "string" ? params["status"] : undefined;
  const resultLimit = typeof params["limit"] === "number" ? Math.min(params["limit"], 50) : 20;

  // Resolve department filter to an ID
  let deptId: string | undefined;
  if (deptFilter) {
    const dept = await prisma.department.findFirst({
      where: {
        OR: [
          { id: deptFilter },
          { departmentId: deptFilter },
          { name: { contains: deptFilter, mode: "insensitive" } },
        ],
      },
      select: { id: true },
    });
    deptId = dept?.id;
  }

  const employees = await prisma.employeeProfile.findMany({
    where: {
      // Manager-scope row filter (skipped for unrestricted/superuser callers).
      ...(visibility.unrestricted ? {} : { id: { in: visibility.visibleProfileIds } }),
      ...(searchTerm ? {
        OR: [
          { displayName: { contains: searchTerm, mode: "insensitive" } },
          { workEmail: { contains: searchTerm, mode: "insensitive" } },
        ],
      } : {}),
      ...(deptId ? { departmentId: deptId } : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
    },
    select: {
      employeeId: true,
      displayName: true,
      workEmail: true,
      status: true,
      department: { select: { name: true } },
      position: { select: { title: true } },
    },
    orderBy: { displayName: "asc" },
    take: resultLimit,
  });

  if (employees.length === 0) {
    return { success: true, message: "No employees found matching your criteria.", data: { employees: [] } };
  }

  const list = employees.map((e) =>
    `${e.displayName} (${e.employeeId}) — ${e.department?.name ?? "No dept"}, ${e.position?.title ?? "No position"}, ${e.status}${e.workEmail ? ` <${e.workEmail}>` : ""}`
  ).join("\n");

  return {
    success: true,
    message: `${employees.length} employee${employees.length !== 1 ? "s" : ""} found:\n${list}`,
    data: {
      employees: employees.map((e) => ({
        employeeId: e.employeeId,
        displayName: e.displayName,
        workEmail: e.workEmail ?? null,
        status: e.status,
        department: e.department?.name ?? null,
        position: e.position?.title ?? null,
      })),
    },
  };
}

async function listDepartments(): Promise<ToolResult> {
  const { prisma } = await import("@dpf/db");
  const departments = await prisma.department.findMany({
    where: { status: "active" },
    select: { departmentId: true, name: true },
    orderBy: { name: "asc" },
  });
  if (departments.length === 0) {
    return { success: true, message: "No departments have been set up yet.", data: { departments: [] } };
  }
  const list = departments.map((d) => `${d.name} (${d.departmentId})`).join("\n");
  return {
    success: true,
    message: `${departments.length} active department${departments.length !== 1 ? "s" : ""}:\n${list}`,
    data: { departments: departments.map((d) => ({ id: d.departmentId, name: d.name })) },
  };
}

async function listPositions(): Promise<ToolResult> {
  const { prisma } = await import("@dpf/db");
  const positions = await prisma.position.findMany({
    where: { status: "active" },
    select: { positionId: true, title: true, jobFamily: true },
    orderBy: { title: "asc" },
  });
  if (positions.length === 0) {
    return { success: true, message: "No positions have been set up yet.", data: { positions: [] } };
  }
  const list = positions.map((p) => `${p.title}${p.jobFamily ? ` — ${p.jobFamily}` : ""} (${p.positionId})`).join("\n");
  return {
    success: true,
    message: `${positions.length} active position${positions.length !== 1 ? "s" : ""}:\n${list}`,
    data: { positions: positions.map((p) => ({ id: p.positionId, title: p.title, jobFamily: p.jobFamily ?? null })) },
  };
}

async function createEmployee(params: Record<string, unknown>, userId: string): Promise<ToolResult> {
  const { prisma } = await import("@dpf/db");
  // Email uniqueness check
  if (typeof params["workEmail"] === "string") {
    const existing = await prisma.employeeProfile.findFirst({
      where: { workEmail: params["workEmail"] },
      select: { displayName: true, employeeId: true },
    });
    if (existing) {
      return {
        success: false,
        error: "duplicate_email",
        message: `An employee with email "${params["workEmail"]}" already exists: ${existing.displayName} (${existing.employeeId}).`,
      };
    }
  }

  // Resolve department: match by cuid, departmentId, or name (case-insensitive)
  let resolvedDepartmentId: string | undefined;
  if (typeof params["departmentId"] === "string") {
    const dept = await prisma.department.findFirst({
      where: {
        OR: [
          { id: params["departmentId"] },
          { departmentId: params["departmentId"] },
          { name: { equals: params["departmentId"], mode: "insensitive" } },
        ],
        status: "active",
      },
      select: { id: true },
    });
    resolvedDepartmentId = dept?.id;
  }

  // Resolve position: match by cuid, positionId, or title (case-insensitive)
  let resolvedPositionId: string | undefined;
  if (typeof params["positionId"] === "string") {
    const pos = await prisma.position.findFirst({
      where: {
        OR: [
          { id: params["positionId"] },
          { positionId: params["positionId"] },
          { title: { equals: params["positionId"], mode: "insensitive" } },
        ],
        status: "active",
      },
      select: { id: true },
    });
    resolvedPositionId = pos?.id;
  }

  // Resolve manager: match by cuid, employeeId, displayName, or email
  let resolvedManagerId: string | undefined;
  if (typeof params["managerEmployeeId"] === "string") {
    const mgr = params["managerEmployeeId"] as string;
    const found = await prisma.employeeProfile.findFirst({
      where: { OR: [{ id: mgr }, { employeeId: mgr }, { displayName: mgr }, { workEmail: mgr }] },
      select: { id: true },
    });
    resolvedManagerId = found?.id;
  }

  const employeeId = `EMP-${randomUUID().slice(0, 8).toUpperCase()}`;
  const status = String(params["status"] ?? "offer");
  const eventType = status === "offer" ? "offer_created" : status === "active" ? "hired" : "onboarding_started";

  const employee = await prisma.employeeProfile.create({
    data: {
      employeeId,
      firstName: String(params["firstName"] ?? ""),
      lastName: String(params["lastName"] ?? ""),
      displayName: `${String(params["firstName"] ?? "")} ${String(params["lastName"] ?? "")}`.trim(),
      workEmail: typeof params["workEmail"] === "string" ? params["workEmail"] : undefined,
      status,
      ...(resolvedDepartmentId ? { departmentId: resolvedDepartmentId } : {}),
      ...(resolvedPositionId ? { positionId: resolvedPositionId } : {}),
      ...(resolvedManagerId ? { managerEmployeeId: resolvedManagerId } : {}),
      ...(typeof params["startDate"] === "string" ? { startDate: new Date(params["startDate"]) } : {}),
      employmentEvents: {
        create: {
          eventId: `EVT-${randomUUID().slice(0, 8).toUpperCase()}`,
          eventType,
          effectiveAt: typeof params["startDate"] === "string" ? new Date(params["startDate"]) : new Date(),
          reason: "Created via AI co-worker",
          actorUserId: userId,
        },
      },
    },
  });

  // Identity spine: every human-creation path must produce a linked human
  // Principal, same as the governed People-screen createEmployeeProfile path
  // (BI-4150F4D6). syncEmployeePrincipal is idempotent; a sync failure must not
  // orphan the created employee, so it is best-effort and logged.
  const { syncEmployeePrincipal } = await import("@/lib/identity/principal-linking");
  await syncEmployeePrincipal(employee.id).catch((err: unknown) => {
    console.error("[workforce-pack.createEmployee] principal sync failed", err);
  });

  return {
    success: true,
    entityId: employee.employeeId,
    message: `Employee ${employee.displayName} (${employee.employeeId}) created with status "${status}".`,
  };
}

async function transitionEmployeeStatus(params: Record<string, unknown>, userId: string): Promise<ToolResult> {
  const { prisma } = await import("@dpf/db");
  const employee = await prisma.employeeProfile.findUnique({
    where: { employeeId: String(params["employeeId"]) },
  });
  if (!employee) return { success: false, error: "Employee not found", message: `Employee ${String(params["employeeId"])} not found` };

  const newStatus = String(params["newStatus"]);
  const { validateLifecycleTransition } = await import("@/lib/workforce-types");
  const error = validateLifecycleTransition({
    currentStatus: employee.status as import("@/lib/workforce-types").WorkforceStatus,
    nextStatus: newStatus as import("@/lib/workforce-types").WorkforceStatus,
    eventType: "activated",
    terminationDate: newStatus === "inactive" ? new Date() : null,
  });
  if (error) return { success: false, error, message: error };

  const eventMap: Record<string, string> = {
    onboarding: employee.status === "offer" ? "offer_accepted" : "onboarding_started",
    active: employee.status === "onboarding" ? "onboarding_completed" : "activated",
    leave: "leave_started",
    suspended: "suspended",
    offboarding: "offboarding_started",
    inactive: employee.status === "offboarding" ? "offboarding_completed" : "terminated",
  };

  // BI-2624B7EA: the MCP surface writes employment events too, so it actuates
  // through the same canonical writer. An event recorded by an agent must open
  // the same Workroom an event recorded through the portal does — governance
  // approves evidence, not provenance.
  const { recordAndActuateEmploymentEvent } = await import(
    "@/lib/workforce/employment-event-actuator-runtime"
  );
  await prisma.$transaction(async (tx) => {
    await tx.employeeProfile.update({
      where: { employeeId: String(params["employeeId"]) },
      data: { status: newStatus },
    });
    await recordAndActuateEmploymentEvent(tx as never, {
      employeeProfileId: employee.id,
      eventType: (eventMap[newStatus] ??
        "activated") as import("@/lib/workforce-types").EmploymentEventType,
      effectiveAt: new Date(),
      reason: typeof params["reason"] === "string" ? params["reason"] : null,
      actorUserId: userId,
    });
  });

  return {
    success: true,
    entityId: employee.employeeId,
    message: `${employee.displayName} transitioned from "${employee.status}" to "${newStatus}".`,
  };
}

async function proposeLeavePolicy(params: Record<string, unknown>): Promise<ToolResult> {
  const { prisma } = await import("@dpf/db");
  const policies = params["policies"] as Array<{ leaveType: string; name: string; annualAllocation: number; carryoverLimit?: number }> | undefined;
  if (!policies || !Array.isArray(policies)) return { success: false, error: "No policies provided", message: "Provide an array of policy suggestions" };

  let created = 0;
  for (const p of policies) {
    const policyId = `LP-${randomUUID().slice(0, 8).toUpperCase()}`;
    await prisma.leavePolicy.create({
      data: {
        policyId,
        leaveType: p.leaveType,
        name: p.name,
        annualAllocation: p.annualAllocation,
        carryoverLimit: p.carryoverLimit ?? null,
        isDefault: true,
      },
    });
    created++;
  }
  return {
    success: true,
    message: `Created ${created} leave ${created !== 1 ? "policies" : "policy"} for ${String(params["locationContext"])}.`,
  };
}

const handlers: Record<string, ToolPackHandler> = {
  query_employees: (params, userId) => queryEmployees(params, userId),
  list_departments: () => listDepartments(),
  list_positions: () => listPositions(),
  create_employee: (params, userId) => createEmployee(params, userId),
  transition_employee_status: (params, userId) => transitionEmployeeStatus(params, userId),
  propose_leave_policy: (params) => proposeLeavePolicy(params),
};

export const workforcePack: ToolPack = {
  packId: "workforce",
  definitions,
  handlers,
  grants: {
    query_employees: ["consumer_read", "registry_read"],
    list_departments: ["registry_read"],
    list_positions: ["registry_read"],
    create_employee: ["consumer_write"],
    transition_employee_status: ["consumer_write"],
    propose_leave_policy: ["policy_write"],
  },
};
