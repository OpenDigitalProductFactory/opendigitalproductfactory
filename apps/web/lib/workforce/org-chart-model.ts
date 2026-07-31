// Pure org-chart model for the People > Org Chart surface (BI-HCM-004).
//
// Everything here is pure and DB-free so the reporting structure can be unit-tested
// without React Flow or Prisma. The view layer (OrgChartView) renders what these
// functions compute; the server action (`assignEmployeeOrg`) reuses the cycle guard
// so a reassignment can never strand part of the workforce.
//
// Two defects in the previous indented-list implementation are fixed here:
//   1. A pre-existing manager cycle (A reports to B, B reports to A) produced NO root,
//      so every employee in the cycle silently vanished from the chart. Cycle members
//      are now detected and surfaced as `cyclic` instead of dropped.
//   2. Nothing prevented a reassignment from CREATING such a cycle — the action only
//      blocked self-management. `wouldCreateManagerCycle` closes that.

/**
 * The minimum an employee row needs for reporting-structure maths. Keeping the helpers
 * structural (rather than binding them to `EmployeeDirectoryRow`) lets `assignEmployeeOrg`
 * run the cycle guard from a two-column Prisma select instead of loading the full directory.
 */
export type OrgReportingRow = {
  id: string;
  managerEmployeeId: string | null;
  dottedLineManagerId?: string | null;
};

export type OrgEdgeKind = "line" | "dotted";

export type OrgEdge = {
  /** Manager side of the relationship. */
  source: string;
  /** Report side of the relationship. */
  target: string;
  kind: OrgEdgeKind;
};

export type OrgNodeMetrics = {
  /** People who report directly to this person. */
  directReports: number;
  /** Everyone beneath this person in the solid-line tree. */
  totalReports: number;
  /** Distance from a root. Roots are depth 0. */
  depth: number;
  /** True when this person has no solid-line manager inside the workforce. */
  isRoot: boolean;
  /**
   * True when this person sits inside a manager cycle. Cycle members have no path to a
   * root, so they are laid out as their own component rather than dropped.
   */
  isCyclic: boolean;
};

export type OrgGraph<T extends OrgReportingRow = OrgReportingRow> = {
  employees: T[];
  edges: OrgEdge[];
  metrics: Map<string, OrgNodeMetrics>;
  rootIds: string[];
  /** Ids of everyone caught in a manager cycle — surfaced to the operator as a data problem. */
  cyclicIds: string[];
};

/** Index employees by id, ignoring duplicates defensively. */
function indexById<T extends OrgReportingRow>(employees: T[]): Map<string, T> {
  const byId = new Map<string, T>();
  for (const emp of employees) byId.set(emp.id, emp);
  return byId;
}

/**
 * Resolve the solid-line manager id, but only when that manager is part of the supplied
 * workforce. A manager outside the set (filtered out, offboarded, bad data) makes the
 * employee a root rather than an orphan.
 */
function resolveManagerId(
  emp: OrgReportingRow,
  byId: Map<string, OrgReportingRow>,
): string | null {
  const managerId = emp.managerEmployeeId;
  if (!managerId || managerId === emp.id) return null;
  return byId.has(managerId) ? managerId : null;
}

/**
 * Walk up the management chain from `employeeId` and return every ancestor id.
 * Terminates on a cycle rather than looping forever; `hitCycle` reports which happened.
 */
export function collectAncestorIds(
  employees: OrgReportingRow[],
  employeeId: string,
): { ancestorIds: string[]; hitCycle: boolean } {
  const byId = indexById(employees);
  const ancestorIds: string[] = [];
  const seen = new Set<string>([employeeId]);

  let current = byId.get(employeeId);
  while (current) {
    const managerId = resolveManagerId(current, byId);
    if (!managerId) return { ancestorIds, hitCycle: false };
    if (seen.has(managerId)) return { ancestorIds, hitCycle: true };
    seen.add(managerId);
    ancestorIds.push(managerId);
    current = byId.get(managerId);
  }

  return { ancestorIds, hitCycle: false };
}

/** Every id beneath `employeeId` in the solid-line tree. Cycle-safe. */
export function collectDescendantIds(
  employees: OrgReportingRow[],
  employeeId: string,
): string[] {
  const byId = indexById(employees);
  const childrenByManager = new Map<string, string[]>();
  for (const emp of employees) {
    const managerId = resolveManagerId(emp, byId);
    if (!managerId) continue;
    const list = childrenByManager.get(managerId) ?? [];
    list.push(emp.id);
    childrenByManager.set(managerId, list);
  }

  const descendants: string[] = [];
  const seen = new Set<string>([employeeId]);
  const queue = [...(childrenByManager.get(employeeId) ?? [])];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    descendants.push(id);
    queue.push(...(childrenByManager.get(id) ?? []));
  }
  return descendants;
}

/**
 * Would setting `nextManagerId` as `employeeId`'s manager create a reporting cycle?
 *
 * True when the proposed manager IS the employee, or is anywhere beneath the employee in
 * the current solid-line tree. This is the guard `assignEmployeeOrg` needs: without it a
 * two-step reassignment (A under B, then B under A) detaches that whole branch from every
 * root, which the renderer can only show as a data problem.
 */
export function wouldCreateManagerCycle(
  employees: OrgReportingRow[],
  employeeId: string,
  nextManagerId: string | null | undefined,
): boolean {
  if (!nextManagerId) return false;
  if (nextManagerId === employeeId) return true;
  return collectDescendantIds(employees, employeeId).includes(nextManagerId);
}

/**
 * Build the renderable org graph: solid-line edges, dotted-line edges, per-person metrics,
 * roots, and any cycle members.
 */
export function buildOrgGraph<T extends OrgReportingRow>(employees: T[]): OrgGraph<T> {
  const byId = indexById(employees);
  const edges: OrgEdge[] = [];
  const childrenByManager = new Map<string, string[]>();
  const rootIds: string[] = [];

  for (const emp of employees) {
    const managerId = resolveManagerId(emp, byId);
    if (managerId) {
      edges.push({ source: managerId, target: emp.id, kind: "line" });
      const list = childrenByManager.get(managerId) ?? [];
      list.push(emp.id);
      childrenByManager.set(managerId, list);
    } else {
      rootIds.push(emp.id);
    }

    const dottedId = emp.dottedLineManagerId;
    if (dottedId && dottedId !== emp.id && byId.has(dottedId) && dottedId !== managerId) {
      edges.push({ source: dottedId, target: emp.id, kind: "dotted" });
    }
  }

  // Depth + reachability from the roots. Anything unreached sits in a cycle.
  const depthById = new Map<string, number>();
  const queue: Array<{ id: string; depth: number }> = rootIds.map((id) => ({ id, depth: 0 }));
  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (depthById.has(id)) continue;
    depthById.set(id, depth);
    for (const childId of childrenByManager.get(id) ?? []) {
      queue.push({ id: childId, depth: depth + 1 });
    }
  }

  const cyclicIds = employees.filter((emp) => !depthById.has(emp.id)).map((emp) => emp.id);

  const metrics = new Map<string, OrgNodeMetrics>();
  for (const emp of employees) {
    const isCyclic = !depthById.has(emp.id);
    metrics.set(emp.id, {
      directReports: (childrenByManager.get(emp.id) ?? []).length,
      totalReports: collectDescendantIds(employees, emp.id).length,
      depth: depthById.get(emp.id) ?? 0,
      isRoot: rootIds.includes(emp.id),
      isCyclic,
    });
  }

  return { employees, edges, metrics, rootIds, cyclicIds };
}

/**
 * Managers a person may legally be reassigned to: everyone except themselves and their own
 * descendants. Drives the manager picker so an illegal option is never offered.
 */
export function eligibleManagers<T extends OrgReportingRow>(
  employees: T[],
  employeeId: string,
): T[] {
  const blocked = new Set<string>([employeeId, ...collectDescendantIds(employees, employeeId)]);
  return employees.filter((emp) => !blocked.has(emp.id));
}
