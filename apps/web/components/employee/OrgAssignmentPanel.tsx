import type { EmployeeProfileRecord } from "@/lib/workforce-types";

type DepartmentRef = {
  id: string;
  departmentId: string;
  name: string;
  parentDepartmentId: string | null;
};

type PositionRef = {
  id: string;
  positionId: string;
  title: string;
};

type WorkLocationRef = {
  id: string;
  locationId: string;
  name: string;
  timezone: string | null;
};

type Props = {
  employee: EmployeeProfileRecord | null;
  departments: DepartmentRef[];
  positions: PositionRef[];
  workLocations: WorkLocationRef[];
};

export function OrgAssignmentPanel({ employee, departments, positions, workLocations }: Props) {
  return (
    <section className="rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] p-4 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Organization assignment</h2>
        <p className="text-xs text-[var(--dpf-muted)] mt-1">
          Current placement plus reference sets for department, position, and location.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 space-y-2">
          <p className="text-xs font-semibold text-[var(--dpf-text)]">Current assignment</p>
          {!employee ? (
            <p className="text-xs text-[var(--dpf-muted)]">No employee profile selected yet.</p>
          ) : (
            <dl className="grid grid-cols-1 gap-2 text-xs">
              <div>
                <dt className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Department</dt>
                <dd className="text-[var(--dpf-text)]">{employee.departmentName ?? "Unassigned"}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Position</dt>
                <dd className="text-[var(--dpf-text)]">{employee.positionTitle ?? "Unassigned"}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Manager</dt>
                <dd className="text-[var(--dpf-text)]">{employee.managerName ?? "None"}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Work location</dt>
                <dd className="text-[var(--dpf-text)]">{employee.workLocationName ?? "Not set"}</dd>
              </div>
            </dl>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3">
          <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
            <p className="text-xs font-semibold text-[var(--dpf-text)]">Reference coverage</p>
            <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-[var(--dpf-muted)]">
              <span>{departments.length} departments</span>
              <span>{positions.length} positions</span>
              <span>{workLocations.length} locations</span>
            </div>
          </div>
          <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
            <p className="text-xs font-semibold text-[var(--dpf-text)]">Available departments</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {departments.slice(0, 6).map((department) => (
                <span
                  key={department.id}
                  className="rounded-full border border-[var(--dpf-border)] px-2 py-1 text-[10px] text-[var(--dpf-muted)]"
                >
                  {department.name}
                </span>
              ))}
              {departments.length === 0 && <span className="text-[10px] text-[var(--dpf-muted)]">No department references yet.</span>}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
