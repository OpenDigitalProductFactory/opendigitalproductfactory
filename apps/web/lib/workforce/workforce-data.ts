import { prisma } from "@dpf/db";
import type { EmployeeDirectoryRow, EmployeeProfileRecord } from "./workforce-types";

export function summarizeEmployeeDisplayName(input: {
  firstName: string;
  middleName?: string | null;
  lastName: string;
  displayName?: string | null;
}): string {
  const displayName = input.displayName?.trim();
  if (displayName) return displayName;
  return [input.firstName, input.middleName ?? null, input.lastName]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(" ");
}

export async function getEmployeeDirectoryRows(): Promise<EmployeeDirectoryRow[]> {
  const employees = await prisma.employeeProfile.findMany({
    orderBy: { displayName: "asc" },
    select: {
      id: true,
      employeeId: true,
      userId: true,
      displayName: true,
      workEmail: true,
      status: true,
      departmentId: true,
      positionId: true,
      managerEmployeeId: true,
      dottedLineManagerId: true,
      workLocationId: true,
      department: { select: { name: true } },
      position: { select: { title: true } },
      manager: { select: { displayName: true } },
      dottedLineManager: { select: { displayName: true } },
      workLocation: { select: { name: true } },
    },
  });

  return employees.map((employee) => ({
    id: employee.id,
    employeeId: employee.employeeId,
    userId: employee.userId,
    displayName: employee.displayName,
    workEmail: employee.workEmail,
    status: employee.status as EmployeeDirectoryRow["status"],
    departmentId: employee.departmentId,
    departmentName: employee.department?.name ?? null,
    positionId: employee.positionId,
    positionTitle: employee.position?.title ?? null,
    managerEmployeeId: employee.managerEmployeeId,
    managerName: employee.manager?.displayName ?? null,
    dottedLineManagerId: employee.dottedLineManagerId,
    dottedLineManagerName: employee.dottedLineManager?.displayName ?? null,
    workLocationId: employee.workLocationId,
    workLocationName: employee.workLocation?.name ?? null,
  }));
}

// One select shape for the full profile record, shared by every lookup path.
// Keeping it in one place means a field added to EmployeeProfileRecord cannot be
// served by one accessor and silently missing from another.
const EMPLOYEE_PROFILE_SELECT = {
  id: true,
  employeeId: true,
  userId: true,
  firstName: true,
  middleName: true,
  lastName: true,
  displayName: true,
  workEmail: true,
  personalEmail: true,
  phoneWork: true,
  phoneMobile: true,
  phoneEmergency: true,
  status: true,
  employmentTypeId: true,
  departmentId: true,
  positionId: true,
  managerEmployeeId: true,
  dottedLineManagerId: true,
  workLocationId: true,
  timezone: true,
  startDate: true,
  confirmationDate: true,
  endDate: true,
  department: { select: { name: true } },
  position: { select: { title: true } },
  manager: { select: { displayName: true } },
  workLocation: { select: { name: true } },
} as const;

/** The row shape produced by EMPLOYEE_PROFILE_SELECT. */
type EmployeeProfileRow = Omit<
  EmployeeProfileRecord,
  "status" | "departmentName" | "positionTitle" | "managerName" | "workLocationName"
> & {
  status: string;
  department: { name: string } | null;
  position: { title: string } | null;
  manager: { displayName: string } | null;
  workLocation: { name: string } | null;
};

function toEmployeeProfileRecord(employee: EmployeeProfileRow): EmployeeProfileRecord {
  return {
    id: employee.id,
    employeeId: employee.employeeId,
    userId: employee.userId,
    firstName: employee.firstName,
    middleName: employee.middleName,
    lastName: employee.lastName,
    displayName: employee.displayName,
    workEmail: employee.workEmail,
    personalEmail: employee.personalEmail,
    phoneWork: employee.phoneWork,
    phoneMobile: employee.phoneMobile,
    phoneEmergency: employee.phoneEmergency,
    status: employee.status as EmployeeProfileRecord["status"],
    employmentTypeId: employee.employmentTypeId,
    departmentId: employee.departmentId,
    departmentName: employee.department?.name ?? null,
    positionId: employee.positionId,
    positionTitle: employee.position?.title ?? null,
    managerEmployeeId: employee.managerEmployeeId,
    managerName: employee.manager?.displayName ?? null,
    dottedLineManagerId: employee.dottedLineManagerId,
    workLocationId: employee.workLocationId,
    workLocationName: employee.workLocation?.name ?? null,
    timezone: employee.timezone,
    startDate: employee.startDate,
    confirmationDate: employee.confirmationDate,
    endDate: employee.endDate,
  };
}

export async function getEmployeeProfileByUserId(userId: string): Promise<EmployeeProfileRecord | null> {
  const employee = await prisma.employeeProfile.findUnique({
    where: { userId },
    select: EMPLOYEE_PROFILE_SELECT,
  });
  return employee ? toEmployeeProfileRecord(employee) : null;
}

/**
 * Look a profile up by its own primary key. The directory selects on this, not on
 * userId: an employee with no linked user account has no userId, so the byUserId
 * path could never reach them at all (BI-00CB9CCC).
 */
export async function getEmployeeProfileById(
  employeeProfileId: string,
): Promise<EmployeeProfileRecord | null> {
  const employee = await prisma.employeeProfile.findUnique({
    where: { id: employeeProfileId },
    select: EMPLOYEE_PROFILE_SELECT,
  });
  return employee ? toEmployeeProfileRecord(employee) : null;
}

export async function getWorkforceReferenceData() {
  const [employmentTypes, positions, workLocations, departments] = await Promise.all([
    prisma.employmentType.findMany({
      where: { status: "active" },
      orderBy: { name: "asc" },
      select: { id: true, employmentTypeId: true, name: true },
    }),
    prisma.position.findMany({
      where: { status: "active" },
      orderBy: { title: "asc" },
      select: { id: true, positionId: true, title: true },
    }),
    prisma.workLocation.findMany({
      where: { status: "active" },
      orderBy: { name: "asc" },
      select: { id: true, locationId: true, name: true, timezone: true },
    }),
    prisma.department.findMany({
      where: { status: "active" },
      orderBy: { name: "asc" },
      select: { id: true, departmentId: true, name: true, parentDepartmentId: true },
    }),
  ]);

  return { employmentTypes, positions, workLocations, departments };
}

export async function getEmployeeLifecycleEvents(employeeProfileId: string) {
  return prisma.employmentEvent.findMany({
    where: { employeeProfileId },
    orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }],
    take: 20,
    select: {
      id: true,
      eventId: true,
      eventType: true,
      effectiveAt: true,
      reason: true,
      createdAt: true,
    },
  });
}
