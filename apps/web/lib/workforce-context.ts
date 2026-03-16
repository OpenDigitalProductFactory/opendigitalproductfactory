import type { WorkforceContext, WorkforceStatus } from "./workforce-types";

export function buildWorkforceContext(input: {
  employeeId: string;
  departmentId?: string | null;
  managerEmployeeId?: string | null;
  status: WorkforceStatus;
  workLocationId?: string | null;
  timezone?: string | null;
}): WorkforceContext {
  return {
    employeeId: input.employeeId,
    employmentStatus: input.status,
    ...(input.departmentId ? { departmentId: input.departmentId } : {}),
    ...(input.managerEmployeeId ? { managerEmployeeId: input.managerEmployeeId } : {}),
    ...(input.workLocationId ? { workLocationId: input.workLocationId } : {}),
    ...(input.timezone ? { timezone: input.timezone } : {}),
  };
}
