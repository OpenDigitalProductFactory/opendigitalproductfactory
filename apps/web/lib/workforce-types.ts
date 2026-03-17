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
