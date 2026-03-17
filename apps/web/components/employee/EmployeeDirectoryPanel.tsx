"use client";

import { useState, useMemo } from "react";
import type { EmployeeDirectoryRow } from "@/lib/workforce-types";

type Props = {
  employees: EmployeeDirectoryRow[];
};

function formatStatus(status: EmployeeDirectoryRow["status"]): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/** Count direct reports for each employee id */
function buildDirectReportCounts(employees: EmployeeDirectoryRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const emp of employees) {
    if (emp.managerEmployeeId) {
      counts.set(emp.managerEmployeeId, (counts.get(emp.managerEmployeeId) ?? 0) + 1);
    }
  }
  return counts;
}

/** Compute manager chain depth for each employee (0 = no manager) */
function buildDepthMap(employees: EmployeeDirectoryRow[]): Map<string, number> {
  const byId = new Map<string, EmployeeDirectoryRow>();
  for (const emp of employees) byId.set(emp.id, emp);

  const cache = new Map<string, number>();

  function depth(id: string, visited: Set<string>): number {
    if (cache.has(id)) return cache.get(id)!;
    const emp = byId.get(id);
    if (!emp || !emp.managerEmployeeId || visited.has(id)) {
      cache.set(id, 0);
      return 0;
    }
    visited.add(id);
    const d = 1 + depth(emp.managerEmployeeId, visited);
    cache.set(id, d);
    return d;
  }

  for (const emp of employees) {
    depth(emp.id, new Set());
  }
  return cache;
}

type ManagerGroup = {
  managerId: string | null;
  managerName: string;
  members: EmployeeDirectoryRow[];
};

function groupByManager(employees: EmployeeDirectoryRow[]): ManagerGroup[] {
  const groups = new Map<string, ManagerGroup>();

  for (const emp of employees) {
    const key = emp.managerEmployeeId ?? "__none__";
    if (!groups.has(key)) {
      groups.set(key, {
        managerId: emp.managerEmployeeId,
        managerName: emp.managerName ?? "No manager",
        members: [],
      });
    }
    groups.get(key)!.members.push(emp);
  }

  // Sort: "No manager" first, then alphabetically by manager name
  return [...groups.values()].sort((a, b) => {
    if (!a.managerId) return -1;
    if (!b.managerId) return 1;
    return a.managerName.localeCompare(b.managerName);
  });
}

function EmployeeCard({
  employee,
  directReportCount,
  indentLevel,
}: {
  employee: EmployeeDirectoryRow;
  directReportCount: number;
  indentLevel: number;
}) {
  return (
    <article
      className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 space-y-3"
      style={{ marginLeft: indentLevel > 0 ? `${indentLevel * 12}px` : undefined }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-mono text-[var(--dpf-muted)]">{employee.employeeId}</p>
          <p className="text-sm font-semibold text-white">
            {employee.displayName}
            {directReportCount > 0 && (
              <span className="ml-2 inline-flex items-center rounded-full bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--dpf-muted)]">
                {directReportCount} report{directReportCount !== 1 ? "s" : ""}
              </span>
            )}
          </p>
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
  );
}

export function EmployeeDirectoryPanel({ employees }: Props) {
  const [groupByMgr, setGroupByMgr] = useState(false);

  const directReportCounts = useMemo(() => buildDirectReportCounts(employees), [employees]);
  const depthMap = useMemo(() => buildDepthMap(employees), [employees]);
  const managerGroups = useMemo(
    () => (groupByMgr ? groupByManager(employees) : null),
    [employees, groupByMgr],
  );

  return (
    <section className="rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white">Employee directory</h2>
          <p className="text-xs text-[var(--dpf-muted)] mt-1">
            Workforce identity, organization placement, and reporting lines.
          </p>
        </div>
        <label className="flex items-center gap-1.5 text-[10px] text-[var(--dpf-muted)] cursor-pointer select-none flex-shrink-0">
          <input
            type="checkbox"
            checked={groupByMgr}
            onChange={(e) => setGroupByMgr(e.target.checked)}
            className="rounded border-[var(--dpf-border)] bg-[var(--dpf-surface-2)]"
          />
          Group by manager
        </label>
      </div>

      {employees.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)]">No employee profiles registered yet.</p>
      ) : managerGroups ? (
        <div className="space-y-4">
          {managerGroups.map((group) => (
            <div key={group.managerId ?? "__none__"}>
              <p className="text-xs font-medium text-[var(--dpf-muted)] mb-2 uppercase tracking-widest">
                {group.managerName}
                <span className="ml-1.5 text-[10px] font-mono">
                  ({group.members.length})
                </span>
              </p>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                {group.members.map((employee) => (
                  <EmployeeCard
                    key={employee.id}
                    employee={employee}
                    directReportCount={directReportCounts.get(employee.id) ?? 0}
                    indentLevel={depthMap.get(employee.id) ?? 0}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {employees.map((employee) => (
            <EmployeeCard
              key={employee.id}
              employee={employee}
              directReportCount={directReportCounts.get(employee.id) ?? 0}
              indentLevel={depthMap.get(employee.id) ?? 0}
            />
          ))}
        </div>
      )}
    </section>
  );
}
