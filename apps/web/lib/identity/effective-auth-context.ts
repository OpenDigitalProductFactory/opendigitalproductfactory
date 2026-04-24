import type { DpfSession } from "@/lib/govern/auth";

type EmployeeScopeInput = {
  id: string;
  directReports?: Array<{ id: string }>;
} | null;

type EffectiveAuthContextInput = {
  user: Pick<DpfSession["user"], "id" | "type" | "platformRole" | "isSuperuser">;
  grantedCapabilities: string[];
  principalId?: string | null;
  employeeProfile?: EmployeeScopeInput;
};

export type EffectiveAuthContext = {
  principalId: string | null;
  platformRole: string | null;
  isSuperuser: boolean;
  employeeId: string | null;
  managerScope: {
    directReportIds: string[];
    indirectReportIds: string[];
  } | null;
  grantedCapabilities: string[];
};

function toPrincipalId(userId: string | null | undefined): string | null {
  if (!userId) return null;
  return `PRN-USER-${userId}`;
}

export function buildEffectiveAuthContext({
  user,
  grantedCapabilities,
  principalId,
  employeeProfile,
}: EffectiveAuthContextInput): EffectiveAuthContext {
  const directReportIds = employeeProfile?.directReports?.map((report) => report.id) ?? [];

  return {
    principalId: user.type === "admin" ? principalId ?? toPrincipalId(user.id) : null,
    platformRole: user.platformRole,
    isSuperuser: user.isSuperuser,
    employeeId: employeeProfile?.id ?? null,
    managerScope: employeeProfile
      ? {
          directReportIds,
          indirectReportIds: [],
        }
      : null,
    grantedCapabilities,
  };
}
