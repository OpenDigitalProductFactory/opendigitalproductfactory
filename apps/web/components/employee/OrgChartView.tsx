"use client";

// People > Org Chart (BI-HCM-004). Node graph via dagre + React Flow (existing deps, as used
// by EaCanvas / ProcessGraph), with drag-to-reassign through the governed
// `reassignEmployeeManager` action. Notes:
//   * Reassignment is permission-checked and audited; the chart never writes Prisma directly.
//   * Loop-creating drops are refused in the UI and the action; the server check is the guarantee.
//   * Filters dim rather than remove, so lines through excluded people do not appear to
//     re-parent anyone.

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { confirmDialog } from "@/components/ui/Dialog";
import { Notice, StatCard, StatusBadge } from "@/components/ui/report-kit";
import { assignEmployeeOrg, reassignEmployeeManager } from "@/lib/actions/workforce";
import { computeOrgChartLayout, ORG_NODE_H, ORG_NODE_W } from "@/lib/graph/layout-org-chart";
import {
  buildOrgGraph,
  eligibleManagers,
  wouldCreateManagerCycle,
} from "@/lib/workforce/org-chart-model";
import type { EmployeeDirectoryRow } from "@/lib/workforce/workforce-types";
import { OrgChartNode, type OrgChartNodeData } from "./OrgChartNode";

/** Reference sets for the placement pickers. Values are row ids — what EmployeeProfile stores. */
export type OrgReferenceData = {
  departments: Array<{ id: string; name: string }>;
  positions: Array<{ id: string; title: string }>;
  workLocations: Array<{ id: string; name: string }>;
};

type Props = {
  employees: EmployeeDirectoryRow[];
  /** When false the chart is read-only (no drag, no pickers). */
  canReassign?: boolean;
  /** Omitted when the caller has no reference sets to offer; placement pickers then hide. */
  referenceData?: OrgReferenceData;
  onSelect?: (employee: EmployeeDirectoryRow) => void;
};

const NODE_TYPES = { orgPerson: OrgChartNode };

type Density = "chart" | "list";

/**
 * The React Flow node envelope for one person.
 *
 * Exported and pure so the size contract is testable: the footprint MUST travel in `style`.
 * React Flow v12 treats top-level `width`/`height` as the internal MEASURED dimensions, so
 * setting them there leaves `measured` unpopulated and edge paths never compute — the chart
 * renders every person with no reporting lines, silently and with no console warning. That
 * shipped once (PR #3801) because unit tests covered the model and layout but never a render.
 */
export function orgFlowNodeShell(input: {
  id: string;
  position: { x: number; y: number };
  draggable: boolean;
}): Pick<Node, "id" | "type" | "position" | "draggable" | "style"> {
  return {
    id: input.id,
    type: "orgPerson",
    position: input.position,
    draggable: input.draggable,
    style: { width: ORG_NODE_W, height: ORG_NODE_H },
  };
}

function matchesSearch(emp: EmployeeDirectoryRow, needle: string): boolean {
  if (!needle) return true;
  const hay = [emp.displayName, emp.positionTitle, emp.departmentName, emp.workEmail]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(needle.toLowerCase());
}

export function OrgChartView(props: Props) {
  return (
    <ReactFlowProvider>
      <OrgChartViewInner {...props} />
    </ReactFlowProvider>
  );
}

function OrgChartViewInner({ employees, canReassign = true, referenceData, onSelect }: Props) {
  const [density, setDensity] = useState<Density>("chart");
  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(
    null,
  );
  const [isPending, startTransition] = useTransition();

  const instanceRef = useRef<ReactFlowInstance | null>(null);

  const graph = useMemo(() => buildOrgGraph(employees), [employees]);
  const byId = useMemo(() => new Map(employees.map((emp) => [emp.id, emp])), [employees]);

  const departments = useMemo(() => {
    const seen = new Map<string, string>();
    for (const emp of employees) {
      if (emp.departmentId && emp.departmentName) seen.set(emp.departmentId, emp.departmentName);
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [employees]);

  const statuses = useMemo(() => [...new Set(employees.map((e) => e.status))].sort(), [employees]);

  /** Ids that survive the current search/filters. Others are dimmed, not removed. */
  const visibleIds = useMemo(() => {
    const ids = new Set<string>();
    for (const emp of employees) {
      if (!matchesSearch(emp, search)) continue;
      if (departmentFilter && emp.departmentId !== departmentFilter) continue;
      if (statusFilter && emp.status !== statusFilter) continue;
      ids.add(emp.id);
    }
    return ids;
  }, [employees, search, departmentFilter, statusFilter]);

  const filtersActive = Boolean(search || departmentFilter || statusFilter);

  const positions = useMemo(
    () =>
      computeOrgChartLayout(
        employees.map((e) => e.id),
        graph.edges,
      ),
    [employees, graph.edges],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    setNodes(
      employees.map((emp) => {
        const metrics = graph.metrics.get(emp.id);
        const data: OrgChartNodeData = {
          name: emp.displayName,
          positionTitle: emp.positionTitle,
          departmentName: emp.departmentName,
          workLocationName: emp.workLocationName,
          status: emp.status,
          directReports: metrics?.directReports ?? 0,
          totalReports: metrics?.totalReports ?? 0,
          isCyclic: metrics?.isCyclic ?? false,
          selected: emp.id === selectedId,
          muted: filtersActive && !visibleIds.has(emp.id),
          dropTarget: emp.id === dropTargetId,
          pending: emp.id === pendingId,
        };
        return {
          ...orgFlowNodeShell({
            id: emp.id,
            position: positions[emp.id] ?? { x: 0, y: 0 },
            draggable: canReassign,
          }),
          data: data as unknown as Record<string, unknown>,
        } satisfies Node;
      }),
    );
  }, [
    employees,
    graph.metrics,
    positions,
    selectedId,
    dropTargetId,
    pendingId,
    visibleIds,
    filtersActive,
    canReassign,
    setNodes,
  ]);

  useEffect(() => {
    setEdges(
      graph.edges.map((edge) => ({
        id: `${edge.kind}-${edge.source}-${edge.target}`,
        source: edge.source,
        target: edge.target,
        type: "smoothstep",
        animated: false,
        style: {
          stroke: edge.kind === "dotted" ? "var(--dpf-muted)" : "var(--dpf-border)",
          strokeWidth: edge.kind === "dotted" ? 1 : 1.5,
          strokeDasharray: edge.kind === "dotted" ? "4 3" : undefined,
          opacity:
            filtersActive && !(visibleIds.has(edge.source) && visibleIds.has(edge.target))
              ? 0.25
              : 1,
        },
        markerEnd: { type: MarkerType.ArrowClosed, color: "var(--dpf-border)" },
      })),
    );
  }, [graph.edges, visibleIds, filtersActive, setEdges]);

  const handleSelect = useCallback(
    (emp: EmployeeDirectoryRow) => {
      setSelectedId(emp.id);
      onSelect?.(emp);
    },
    [onSelect],
  );

  const runReassign = useCallback(
    (employeeId: string, managerId: string | null, line: "solid" | "dotted") => {
      setPendingId(employeeId);
      startTransition(async () => {
        const result = await reassignEmployeeManager({
          employeeProfileId: employeeId,
          ...(line === "solid"
            ? { managerEmployeeId: managerId }
            : { dottedLineManagerId: managerId }),
          line,
        });
        setPendingId(null);
        setFeedback(
          result.ok
            ? { tone: "success", message: result.message }
            : { tone: "error", message: result.message },
        );
      });
    },
    [],
  );

  /**
   * Change one placement field — team, role, or location.
   *
   * Exactly one key is sent. `assignEmployeeOrg` now has PATCH semantics, so the fields this
   * call omits are left alone; before that it rewrote every field from its input and a
   * single-field call silently cleared the other four.
   */
  const runPlacement = useCallback(
    (employeeId: string, field: "departmentId" | "positionId" | "workLocationId", value: string | null) => {
      setPendingId(employeeId);
      startTransition(async () => {
        const result = await assignEmployeeOrg({
          employeeProfileId: employeeId,
          [field]: value,
        });
        setPendingId(null);
        setFeedback(
          result.ok
            ? { tone: "success", message: result.message }
            : { tone: "error", message: result.message },
        );
      });
    },
    [],
  );

  const restorePosition = useCallback(
    (nodeId: string) =>
      setNodes((prev) =>
        prev.map((n) => (n.id === nodeId ? { ...n, position: positions[n.id] ?? n.position } : n)),
      ),
    [positions, setNodes],
  );

  // Dialog awaited OUTSIDE the transition — inside one it never renders and wedges the
  // control (AGENTS.md §12).
  const onNodeDragStop = useCallback(
    async (_event: unknown, node: Node) => {
      setDropTargetId(null);
      if (!canReassign) return;

      const instance = instanceRef.current;
      const dragged = byId.get(node.id);
      if (!instance || !dragged) return;

      const target = instance
        .getIntersectingNodes(node)
        .find((candidate) => candidate.id !== node.id);

      // Dropped on empty canvas — snap back rather than silently detaching the person.
      if (!target) {
        restorePosition(node.id);
        return;
      }

      const manager = byId.get(target.id);
      if (!manager) {
        restorePosition(node.id);
        return;
      }

      if (dragged.managerEmployeeId === manager.id) {
        restorePosition(node.id);
        return;
      }

      if (wouldCreateManagerCycle(employees, dragged.id, manager.id)) {
        restorePosition(node.id);
        setFeedback({
          tone: "error",
          message: `${manager.displayName} reports to ${dragged.displayName} — that would create a loop.`,
        });
        return;
      }

      const confirmed = await confirmDialog({
        title: "Change reporting line",
        message: `${dragged.displayName} will report to ${manager.displayName}. Recorded on their employment record.`,
      });

      restorePosition(node.id);
      if (!confirmed) return;

      runReassign(dragged.id, manager.id, "solid");
    },
    [byId, canReassign, employees, restorePosition, runReassign],
  );

  const onNodeDrag = useCallback(
    (_event: unknown, node: Node) => {
      const instance = instanceRef.current;
      if (!instance || !canReassign) return;
      const target = instance
        .getIntersectingNodes(node)
        .find((candidate) => candidate.id !== node.id);
      setDropTargetId(target?.id ?? null);
    },
    [canReassign],
  );

  const selected = selectedId ? (byId.get(selectedId) ?? null) : null;

  const headline = useMemo(() => {
    const managers = employees.filter((e) => (graph.metrics.get(e.id)?.directReports ?? 0) > 0);
    const totalDirect = managers.reduce(
      (sum, m) => sum + (graph.metrics.get(m.id)?.directReports ?? 0),
      0,
    );
    return {
      headcount: employees.length,
      managers: managers.length,
      avgSpan: managers.length > 0 ? (totalDirect / managers.length).toFixed(1) : "—",
      unmanaged: graph.rootIds.length,
    };
  }, [employees, graph]);

  if (employees.length === 0) {
    return (
      <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <p className="text-sm text-[var(--dpf-muted)]">
          No people yet. Add the first person to start the chart.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4" data-component="org-chart-view">
      {/* Reporting-structure signal. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="People" value={String(headline.headcount)} />
        <StatCard label="Managers" value={String(headline.managers)} />
        <StatCard label="Avg span" value={String(headline.avgSpan)} />
        <StatCard label="No manager" value={String(headline.unmanaged)} />
      </div>

      {graph.cyclicIds.length > 0 && (
        <Notice variant="warn" title="Reporting loop detected">
          {graph.cyclicIds.map((id) => byId.get(id)?.displayName ?? id).join(", ")} report to each
          other in a loop. Give one a manager outside the loop.
        </Notice>
      )}

      {feedback && (
        <Notice
          variant={feedback.tone === "success" ? "success" : "error"}
          title={feedback.tone === "success" ? "Reporting line updated" : "Change not applied"}
        >
          {feedback.message}
        </Notice>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Find a person"
          aria-label="Find a person"
          className="min-w-[200px] flex-1 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-xs text-[var(--dpf-text)]"
        />

        <select
          value={departmentFilter}
          onChange={(e) => setDepartmentFilter(e.target.value)}
          aria-label="Filter by team"
          className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-xs text-[var(--dpf-text)]"
        >
          <option value="" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">
            All teams
          </option>
          {departments.map(([id, name]) => (
            <option key={id} value={id} className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">
              {name}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by status"
          className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-xs text-[var(--dpf-text)]"
        >
          <option value="" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">
            All statuses
          </option>
          {statuses.map((s) => (
            <option key={s} value={s} className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">
              {s}
            </option>
          ))}
        </select>

        <div className="flex overflow-hidden rounded border border-[var(--dpf-border)]">
          {(["chart", "list"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setDensity(mode)}
              aria-pressed={density === mode}
              className="px-2 py-1 text-xs capitalize transition-colors"
              style={{
                backgroundColor: density === mode ? "var(--dpf-accent)" : "var(--dpf-surface-2)",
                color: density === mode ? "var(--dpf-surface-1)" : "var(--dpf-muted)",
              }}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_320px]">
        {density === "chart" ? (
          <div
            className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]"
            style={{ height: 560 }}
          >
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={NODE_TYPES}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onInit={(instance) => {
                instanceRef.current = instance;
                window.setTimeout(() => instance.fitView({ padding: 0.15, duration: 200 }), 0);
              }}
              onNodeDrag={onNodeDrag}
              onNodeDragStop={onNodeDragStop}
              onNodeClick={(_e, node) => {
                const emp = byId.get(node.id);
                if (emp) handleSelect(emp);
              }}
              nodesConnectable={false}
              elementsSelectable
              fitView
              minZoom={0.2}
              maxZoom={1.6}
              proOptions={{ hideAttribution: true }}
            >
              <Background color="var(--dpf-border)" gap={20} />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
        ) : (
          <OrgList
            employees={employees}
            graph={graph}
            visibleIds={visibleIds}
            filtersActive={filtersActive}
            selectedId={selectedId}
            onSelect={handleSelect}
          />
        )}

        <OrgDetailPanel
          employee={selected}
          employees={employees}
          canReassign={canReassign}
          referenceData={referenceData}
          busy={isPending}
          onReassign={runReassign}
          onPlacement={runPlacement}
        />
      </div>

      <p className="text-[10px] text-[var(--dpf-muted)]">
        Dashed lines are dotted-line reports.
        {canReassign ? " Drag a person onto their new manager." : ""}
      </p>
    </section>
  );
}

/** Compact view — a density option for scanning a large workforce. */
function OrgList({
  employees,
  graph,
  visibleIds,
  filtersActive,
  selectedId,
  onSelect,
}: {
  employees: EmployeeDirectoryRow[];
  graph: ReturnType<typeof buildOrgGraph<EmployeeDirectoryRow>>;
  visibleIds: Set<string>;
  filtersActive: boolean;
  selectedId: string | null;
  onSelect: (emp: EmployeeDirectoryRow) => void;
}) {
  const ordered = useMemo(
    () =>
      [...employees].sort((a, b) => {
        const da = graph.metrics.get(a.id)?.depth ?? 0;
        const db = graph.metrics.get(b.id)?.depth ?? 0;
        return da - db || a.displayName.localeCompare(b.displayName);
      }),
    [employees, graph.metrics],
  );

  return (
    <div className="space-y-1 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
      {ordered.map((emp) => {
        const metrics = graph.metrics.get(emp.id);
        const muted = filtersActive && !visibleIds.has(emp.id);
        return (
          <button
            key={emp.id}
            type="button"
            onClick={() => onSelect(emp)}
            className="flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left transition-colors"
            style={{
              marginLeft: (metrics?.depth ?? 0) * 20,
              opacity: muted ? 0.35 : 1,
              backgroundColor: "var(--dpf-surface-1)",
              borderColor: emp.id === selectedId ? "var(--dpf-accent)" : "var(--dpf-border)",
            }}
          >
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--dpf-text)]">
              {emp.displayName}
              {emp.positionTitle && (
                <span className="ml-2 text-[10px] text-[var(--dpf-muted)]">
                  {emp.positionTitle}
                </span>
              )}
            </span>
            <StatusBadge domain="workforceStatus" status={emp.status} size="sm" />
          </button>
        );
      })}
    </div>
  );
}

/** One placement field. Kept local — it is this panel's layout, not a reusable primitive. */
function PlacementPicker({
  label,
  emptyLabel,
  disabled,
  value,
  options,
  onChange,
}: {
  label: string;
  emptyLabel: string;
  disabled: boolean;
  value: string | null;
  options: Array<{ id: string; label: string }>;
  onChange: (value: string | null) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-dpf-caption uppercase tracking-widest text-[var(--dpf-muted)]">
        {label}
      </span>
      <select
        disabled={disabled}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-xs text-[var(--dpf-text)] disabled:opacity-50"
      >
        <option value="" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">
          {emptyLabel}
        </option>
        {options.map((opt) => (
          <option
            key={opt.id}
            value={opt.id}
            className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]"
          >
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Selected person's reporting lines and placement, editable through the governed actions. */
function OrgDetailPanel({
  employee,
  employees,
  canReassign,
  referenceData,
  busy,
  onReassign,
  onPlacement,
}: {
  employee: EmployeeDirectoryRow | null;
  employees: EmployeeDirectoryRow[];
  canReassign: boolean;
  referenceData?: OrgReferenceData;
  busy: boolean;
  onReassign: (employeeId: string, managerId: string | null, line: "solid" | "dotted") => void;
  onPlacement: (
    employeeId: string,
    field: "departmentId" | "positionId" | "workLocationId",
    value: string | null,
  ) => void;
}) {
  const options = useMemo(
    () => (employee ? eligibleManagers(employees, employee.id) : []),
    [employees, employee],
  );

  if (!employee) {
    return (
      <aside className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <p className="text-xs text-[var(--dpf-muted)]">
          Select someone to change their reporting lines.
        </p>
      </aside>
    );
  }

  return (
    <aside className="space-y-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <div>
        <p className="text-sm font-semibold text-[var(--dpf-text)]">{employee.displayName}</p>
        <p className="text-xs text-[var(--dpf-muted)]">
          {employee.positionTitle ?? "No position"}
          {employee.departmentName ? ` · ${employee.departmentName}` : ""}
        </p>
      </div>

      <div className="space-y-2 text-xs">
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
            Reports to
          </span>
          <select
            disabled={!canReassign || busy}
            value={employee.managerEmployeeId ?? ""}
            onChange={(e) => onReassign(employee.id, e.target.value || null, "solid")}
            className="w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-xs text-[var(--dpf-text)] disabled:opacity-50"
          >
            <option value="" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">
              No manager
            </option>
            {options.map((opt) => (
              <option
                key={opt.id}
                value={opt.id}
                className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]"
              >
                {opt.displayName}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
            Dotted line to
          </span>
          <select
            disabled={!canReassign || busy}
            value={employee.dottedLineManagerId ?? ""}
            onChange={(e) => onReassign(employee.id, e.target.value || null, "dotted")}
            className="w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-xs text-[var(--dpf-text)] disabled:opacity-50"
          >
            <option value="" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">
              None
            </option>
            {options.map((opt) => (
              <option
                key={opt.id}
                value={opt.id}
                className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]"
              >
                {opt.displayName}
              </option>
            ))}
          </select>
        </label>

        {/* Placement. Each picker sends ONE field; the rest are left untouched. */}
        {referenceData && (
          <>
            <PlacementPicker
              label="Team"
              emptyLabel="Unassigned"
              disabled={!canReassign || busy}
              value={employee.departmentId}
              options={referenceData.departments.map((d) => ({ id: d.id, label: d.name }))}
              onChange={(v) => onPlacement(employee.id, "departmentId", v)}
            />
            <PlacementPicker
              label="Role"
              emptyLabel="No role"
              disabled={!canReassign || busy}
              value={employee.positionId}
              options={referenceData.positions.map((p) => ({ id: p.id, label: p.title }))}
              onChange={(v) => onPlacement(employee.id, "positionId", v)}
            />
            <PlacementPicker
              label="Location"
              emptyLabel="No location"
              disabled={!canReassign || busy}
              value={employee.workLocationId}
              options={referenceData.workLocations.map((w) => ({ id: w.id, label: w.name }))}
              onChange={(v) => onPlacement(employee.id, "workLocationId", v)}
            />
          </>
        )}
      </div>

      {!canReassign && (
        <p className="text-[10px] text-[var(--dpf-muted)]">
          You cannot change reporting lines.
        </p>
      )}
    </aside>
  );
}
