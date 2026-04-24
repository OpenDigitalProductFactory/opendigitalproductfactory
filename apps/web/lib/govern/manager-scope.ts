import type { EffectiveAuthContext } from "@/lib/identity/effective-auth-context";

export function canAccessEmployeeScope(
  context: EffectiveAuthContext,
  targetEmployeeId: string,
): boolean {
  if (context.isSuperuser) return true;
  if (context.employeeId === targetEmployeeId) return true;
  return context.managerScope?.directReportIds.includes(targetEmployeeId) ?? false;
}
