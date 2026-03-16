import type { EmployeeDirectoryRow } from "@/lib/workforce-types";

type Props = {
  employees: EmployeeDirectoryRow[];
};

function formatStatus(status: EmployeeDirectoryRow["status"]): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function EmployeeDirectoryPanel({ employees }: Props) {
  return (
    <section className="rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] p-4 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-white">Employee directory</h2>
        <p className="text-xs text-[var(--dpf-muted)] mt-1">
          Workforce identity, organization placement, and reporting lines.
        </p>
      </div>

      {employees.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)]">No employee profiles registered yet.</p>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {employees.map((employee) => (
            <article
              key={employee.id}
              className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 space-y-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-mono text-[var(--dpf-muted)]">{employee.employeeId}</p>
                  <p className="text-sm font-semibold text-white">{employee.displayName}</p>
                  <p className="text-xs text-[var(--dpf-muted)]">{employee.workEmail ?? "No work email set"}</p>
                </div>
                <span className="rounded-full border border-[var(--dpf-border)] px-2 py-1 text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
                  {formatStatus(employee.status)}
                </span>
              </div>

              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div>
                  <dt className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Department</dt>
                  <dd className="text-white">{employee.departmentName ?? "Unassigned"}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Position</dt>
                  <dd className="text-white">{employee.positionTitle ?? "Unassigned"}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Manager</dt>
                  <dd className="text-white">{employee.managerName ?? "None"}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Location</dt>
                  <dd className="text-white">{employee.workLocationName ?? "Unset"}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
