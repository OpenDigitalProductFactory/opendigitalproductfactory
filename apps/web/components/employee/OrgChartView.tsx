"use client";

import { useState, useMemo, useCallback } from "react";
import type { EmployeeDirectoryRow } from "@/lib/workforce-types";

type OrgNode = {
  employee: EmployeeDirectoryRow;
  children: OrgNode[];
  dottedLineChildren: EmployeeDirectoryRow[];
};

type Props = {
  employees: EmployeeDirectoryRow[];
  onSelect?: (employee: EmployeeDirectoryRow) => void;
};

const STATUS_DOT: Record<string, string> = {
  active: "bg-green-500",
  onboarding: "bg-amber-400",
  offer: "bg-amber-400",
  leave: "bg-yellow-500",
  suspended: "bg-red-500",
  offboarding: "bg-gray-400",
  inactive: "bg-gray-400",
};

function buildTree(employees: EmployeeDirectoryRow[]): OrgNode[] {
  const byId = new Map<string, EmployeeDirectoryRow>();
  for (const emp of employees) {
    byId.set(emp.id, emp);
  }

  // Build direct-report children map
  const childrenMap = new Map<string, EmployeeDirectoryRow[]>();
  const roots: EmployeeDirectoryRow[] = [];

  for (const emp of employees) {
    if (emp.managerEmployeeId && byId.has(emp.managerEmployeeId)) {
      const list = childrenMap.get(emp.managerEmployeeId) ?? [];
      list.push(emp);
      childrenMap.set(emp.managerEmployeeId, list);
    } else {
      roots.push(emp);
    }
  }

  // Build dotted-line children map
  const dottedMap = new Map<string, EmployeeDirectoryRow[]>();
  for (const emp of employees) {
    if (emp.dottedLineManagerId && byId.has(emp.dottedLineManagerId)) {
      const list = dottedMap.get(emp.dottedLineManagerId) ?? [];
      list.push(emp);
      dottedMap.set(emp.dottedLineManagerId, list);
    }
  }

  function toNode(emp: EmployeeDirectoryRow): OrgNode {
    const children = (childrenMap.get(emp.id) ?? []).map(toNode);
    const dottedLineChildren = dottedMap.get(emp.id) ?? [];
    return { employee: emp, children, dottedLineChildren };
  }

  return roots.map(toNode);
}

function collectExpandedIds(nodes: OrgNode[], depth: number, maxDepth: number): Set<string> {
  const ids = new Set<string>();
  if (depth >= maxDepth) return ids;
  for (const node of nodes) {
    if (node.children.length > 0) {
      ids.add(node.employee.id);
      for (const id of collectExpandedIds(node.children, depth + 1, maxDepth)) {
        ids.add(id);
      }
    }
  }
  return ids;
}

function OrgNodeRow({
  node,
  depth,
  expanded,
  onToggle,
  onSelect,
  selectedId,
  isDotted,
}: {
  node: OrgNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onSelect: ((emp: EmployeeDirectoryRow) => void) | undefined;
  selectedId: string | null;
  isDotted?: boolean;
}) {
  const hasChildren = node.children.length > 0 || node.dottedLineChildren.length > 0;
  const isOpen = expanded.has(node.employee.id);
  const isSelected = node.employee.id === selectedId;
  const statusColor = STATUS_DOT[node.employee.status] ?? "bg-gray-400";

  return (
    <div>
      <div
        className={[
          "flex items-center gap-2 rounded-md px-3 py-2 cursor-pointer transition-colors",
          "bg-[var(--dpf-surface-1)] border",
          isSelected
            ? "border-[var(--dpf-accent)]"
            : "border-[var(--dpf-border)] hover:border-[var(--dpf-accent)]/40",
          isDotted ? "border-l-2 border-l-dashed" : "",
        ].join(" ")}
        style={{
          marginLeft: `${depth * 24}px`,
          ...(isDotted ? { borderLeftStyle: "dashed", borderLeftColor: "var(--dpf-border)" } : {}),
        }}
        onClick={() => onSelect?.(node.employee)}
      >
        {/* Expand/collapse toggle */}
        <button
          className={[
            "flex items-center justify-center w-4 h-4 text-[10px] text-[var(--dpf-muted)] flex-shrink-0",
            hasChildren ? "cursor-pointer hover:text-white" : "invisible",
          ].join(" ")}
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) onToggle(node.employee.id);
          }}
          aria-label={isOpen ? "Collapse" : "Expand"}
        >
          {hasChildren ? (isOpen ? "\u25BC" : "\u25B6") : ""}
        </button>

        {/* Status dot */}
        <span
          className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${statusColor}`}
          title={node.employee.status}
        />

        {/* Employee info */}
        <div className="min-w-0 flex-1">
          <span className="text-sm font-medium text-white">{node.employee.displayName}</span>
          {node.employee.positionTitle && (
            <span className="text-xs text-[var(--dpf-muted)] ml-2">{node.employee.positionTitle}</span>
          )}
        </div>

        {/* Department */}
        {node.employee.departmentName && (
          <span className="text-[10px] text-[var(--dpf-muted)] flex-shrink-0">
            {node.employee.departmentName}
          </span>
        )}

        {/* Direct report count */}
        {node.children.length > 0 && (
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)] flex-shrink-0">
            {node.children.length} report{node.children.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Children */}
      {isOpen && (
        <div className="mt-1 space-y-1">
          {node.children.map((child) => (
            <OrgNodeRow
              key={child.employee.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
              selectedId={selectedId}
            />
          ))}
          {node.dottedLineChildren.map((emp) => (
            <div
              key={`dotted-${emp.id}`}
              className="flex items-center gap-2 rounded-md px-3 py-2 cursor-pointer transition-colors bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] hover:border-[var(--dpf-accent)]/40"
              style={{
                marginLeft: `${(depth + 1) * 24}px`,
                borderLeftStyle: "dashed",
                borderLeftWidth: "2px",
                borderLeftColor: "var(--dpf-border)",
              }}
              onClick={() => onSelect?.(emp)}
            >
              <span className="w-4 h-4 flex-shrink-0" />
              <span
                className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[emp.status] ?? "bg-gray-400"}`}
                title={emp.status}
              />
              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium text-white">{emp.displayName}</span>
                <span className="text-[10px] text-[var(--dpf-muted)] ml-2 italic">dotted line</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function OrgChartView({ employees, onSelect }: Props) {
  const tree = useMemo(() => buildTree(employees), [employees]);

  const [expanded, setExpanded] = useState<Set<string>>(
    () => collectExpandedIds(tree, 0, 2),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleToggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleSelect = useCallback(
    (emp: EmployeeDirectoryRow) => {
      setSelectedId(emp.id);
      onSelect?.(emp);
    },
    [onSelect],
  );

  if (employees.length === 0) {
    return (
      <section className="rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] p-4">
        <p className="text-sm text-[var(--dpf-muted)]">No employee profiles registered yet.</p>
      </section>
    );
  }

  return (
    <section className="rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white">Organization chart</h2>
          <p className="text-xs text-[var(--dpf-muted)] mt-1">
            Reporting hierarchy based on manager relationships.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className="text-[10px] text-[var(--dpf-muted)] hover:text-white transition-colors px-2 py-1 rounded border border-[var(--dpf-border)]"
            onClick={() => setExpanded(collectExpandedIds(tree, 0, 99))}
          >
            Expand all
          </button>
          <button
            className="text-[10px] text-[var(--dpf-muted)] hover:text-white transition-colors px-2 py-1 rounded border border-[var(--dpf-border)]"
            onClick={() => setExpanded(new Set())}
          >
            Collapse all
          </button>
        </div>
      </div>

      <div className="space-y-1">
        {tree.map((node) => (
          <OrgNodeRow
            key={node.employee.id}
            node={node}
            depth={0}
            expanded={expanded}
            onToggle={handleToggle}
            onSelect={handleSelect}
            selectedId={selectedId}
          />
        ))}
      </div>
    </section>
  );
}
