export type WorkforceStatus =
  | "offer"
  | "onboarding"
  | "active"
  | "leave"
  | "suspended"
  | "offboarding"
  | "inactive";

export type EmploymentEventType =
  | "hired"
  | "offer_created"
  | "offer_accepted"
  | "offer_withdrawn"
  | "onboarding_started"
  | "onboarding_completed"
  | "activated"
  | "manager_changed"
  | "department_changed"
  | "position_changed"
  | "leave_started"
  | "leave_ended"
  | "offboarding_started"
  | "offboarding_completed"
  | "terminated"
  | "reactivated";

// ─── Lifecycle Transition Validation ─────────────────────────────────────────

export const LIFECYCLE_TRANSITION_MATRIX: Record<WorkforceStatus, WorkforceStatus[]> = {
  offer: ["onboarding", "inactive"],
  onboarding: ["active"],
  active: ["leave", "suspended", "offboarding"],
  leave: ["active"],
  suspended: ["active", "offboarding"],
  offboarding: ["inactive"],
  inactive: [],
};

export function validateLifecycleTransition(input: {
  currentStatus: WorkforceStatus;
  nextStatus: WorkforceStatus;
  eventType: EmploymentEventType;
  terminationDate?: Date | null;
}): string | null {
  if (input.eventType === "terminated" && !input.terminationDate) {
    return "Termination date is required for termination events.";
  }

  if (input.currentStatus === input.nextStatus) {
    return "Current status and next status are the same.";
  }

  const allowed = LIFECYCLE_TRANSITION_MATRIX[input.currentStatus];
  if (!allowed || !allowed.includes(input.nextStatus)) {
    return `Cannot transition from "${input.currentStatus}" to "${input.nextStatus}".`;
  }

  return null;
}

// ─── Employee Profile Validation ────────────────────────────────────────────

export type EmployeeProfileInput = {
  employeeProfileId?: string;
  employeeId: string;
  userId?: string | null;
  firstName: string;
  middleName?: string | null;
  lastName: string;
  displayName?: string | null;
  workEmail?: string | null;
  personalEmail?: string | null;
  phoneNumber?: string | null;
  status: WorkforceStatus;
  employmentTypeId?: string | null;
  departmentId?: string | null;
  positionId?: string | null;
  managerEmployeeId?: string | null;
  dottedLineManagerId?: string | null;
  workLocationId?: string | null;
  timezone?: string | null;
  startDate?: Date | null;
  confirmationDate?: Date | null;
  endDate?: Date | null;
};

export function validateEmployeeProfileInput(input: EmployeeProfileInput): string | null {
  if (!input.firstName.trim()) return "Enter a first name.";
  if (!input.lastName.trim()) return "Enter a last name.";

  const selfRefs = [input.employeeProfileId, input.employeeId].filter((value): value is string => Boolean(value?.trim()));
  if (input.managerEmployeeId && selfRefs.includes(input.managerEmployeeId)) {
    return "Employee cannot be their own manager.";
  }
  if (input.dottedLineManagerId && selfRefs.includes(input.dottedLineManagerId)) {
    return "Employee cannot be their own manager.";
  }

  if (input.startDate && input.endDate && input.startDate > input.endDate) {
    return "Start date must be on or before the end date.";
  }
  if (input.startDate && input.confirmationDate && input.confirmationDate < input.startDate) {
    return "Confirmation date cannot be before the start date.";
  }

  return null;
}

// ─── Context Types ──────────────────────────────────────────────────────────

export type WorkforceContext = {
  employeeId: string;
  departmentId?: string;
  managerEmployeeId?: string;
  employmentStatus: WorkforceStatus;
  workLocationId?: string;
  timezone?: string;
};

export type EmployeeDirectoryRow = {
  id: string;
  employeeId: string;
  userId: string | null;
  displayName: string;
  workEmail: string | null;
  status: WorkforceStatus;
  departmentId: string | null;
  departmentName: string | null;
  positionId: string | null;
  positionTitle: string | null;
  managerEmployeeId: string | null;
  managerName: string | null;
  dottedLineManagerId: string | null;
  dottedLineManagerName: string | null;
  workLocationId: string | null;
  workLocationName: string | null;
};

export type EmployeeProfileRecord = {
  id: string;
  employeeId: string;
  userId: string | null;
  firstName: string;
  middleName: string | null;
  lastName: string;
  displayName: string;
  workEmail: string | null;
  personalEmail: string | null;
  phoneNumber: string | null;
  status: WorkforceStatus;
  departmentId: string | null;
  departmentName: string | null;
  positionId: string | null;
  positionTitle: string | null;
  managerEmployeeId: string | null;
  managerName: string | null;
  workLocationId: string | null;
  workLocationName: string | null;
  timezone: string | null;
  startDate: Date | null;
  confirmationDate: Date | null;
  endDate: Date | null;
};
