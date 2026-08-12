import type { EffectiveAuthContext } from "@/lib/identity/effective-auth-context";

/** The manager-scope facts an employee-visibility decision needs. */
type EmployeeScopeContext = Pick<
  EffectiveAuthContext,
  "isSuperuser" | "employeeId" | "managerScope"
>;

export function canAccessEmployeeScope(
  context: EmployeeScopeContext,
  targetEmployeeId: string,
): boolean {
  if (context.isSuperuser) return true;
  if (context.employeeId === targetEmployeeId) return true;
  return (
    context.managerScope?.directReportIds.includes(targetEmployeeId) ||
    context.managerScope?.indirectReportIds.includes(targetEmployeeId) ||
    false
  );
}

export type EmployeeVisibilityScope =
  /** Sees every employee (installation owner / superuser) — no row filter. */
  | { unrestricted: true; visibleProfileIds: string[] }
  /** Sees exactly this set of EmployeeProfile ids (self ∪ direct ∪ indirect reports). */
  | { unrestricted: false; visibleProfileIds: string[] };

/**
 * The set of EmployeeProfile ids this principal may SEE — the row-level dual of
 * {@link canAccessEmployeeScope}. A query-time list filter built from this set
 * returns exactly the rows the principal could open individually (which the
 * coworker-authority `subject-scope-denied` gate enforces on id-addressed
 * calls), so a list surface can never leak an employee the caller can't reach.
 *
 * By construction: `canAccessEmployeeScope(ctx, id)` is true **iff**
 * `id ∈ employeeScopeVisibleIds(ctx).visibleProfileIds` OR the scope is
 * unrestricted. Superuser is unrestricted (mirrors the isSuperuser short-circuit
 * above); everyone else sees self + direct + indirect reports and nothing more.
 */
export function employeeScopeVisibleIds(
  context: EmployeeScopeContext,
): EmployeeVisibilityScope {
  if (context.isSuperuser) return { unrestricted: true, visibleProfileIds: [] };
  const ids = new Set<string>();
  if (context.employeeId) ids.add(context.employeeId);
  for (const id of context.managerScope?.directReportIds ?? []) ids.add(id);
  for (const id of context.managerScope?.indirectReportIds ?? []) ids.add(id);
  return { unrestricted: false, visibleProfileIds: [...ids] };
}
