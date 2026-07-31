"use client";

// Person card rendered on the org-chart canvas (BI-HCM-004).
//
// Colour comes from report-kit's intent registry (`workforceStatus`), never a local
// Tailwind/hex map — the previous implementation hardcoded bg-green-500 / bg-amber-400,
// which ignored theming and branding.

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { StatusBadge } from "@/components/ui/report-kit";
import { ORG_NODE_H, ORG_NODE_W } from "@/lib/graph/layout-org-chart";
import type { WorkforceStatus } from "@/lib/workforce/workforce-types";

export type OrgChartNodeData = {
  name: string;
  positionTitle: string | null;
  departmentName: string | null;
  workLocationName: string | null;
  status: WorkforceStatus;
  directReports: number;
  totalReports: number;
  /** Person sits in a manager loop — shown as a data problem rather than hidden. */
  isCyclic: boolean;
  selected: boolean;
  /** Dimmed because an active search or filter excluded them. */
  muted: boolean;
  /** This card is the pending drop target during a drag-to-reassign. */
  dropTarget: boolean;
  /** A reassignment involving this person is in flight. */
  pending: boolean;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]!}${parts[parts.length - 1]![0]!}`.toUpperCase();
}

function OrgChartNodeImpl({ data }: NodeProps & { data: OrgChartNodeData }) {
  const borderColor = data.dropTarget
    ? "var(--dpf-accent)"
    : data.selected
      ? "var(--dpf-accent)"
      : data.isCyclic
        ? "var(--dpf-error)"
        : "var(--dpf-border)";

  return (
    <div
      data-component="org-chart-node"
      data-employee-name={data.name}
      data-drop-target={data.dropTarget ? "true" : undefined}
      className="rounded-lg border shadow-sm transition-opacity"
      style={{
        width: ORG_NODE_W,
        height: ORG_NODE_H,
        backgroundColor: "var(--dpf-surface-1)",
        borderColor,
        borderWidth: data.dropTarget || data.selected ? 2 : 1,
        opacity: data.muted ? 0.35 : data.pending ? 0.6 : 1,
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />

      <div className="flex h-full flex-col justify-between p-2.5">
        <div className="flex items-start gap-2">
          <span
            aria-hidden="true"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-dpf-caption font-semibold"
            style={{
              backgroundColor: "var(--dpf-surface-2)",
              color: "var(--dpf-muted)",
            }}
          >
            {initials(data.name)}
          </span>

          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-[var(--dpf-text)]" title={data.name}>
              {data.name}
            </p>
            <p
              className="truncate text-dpf-caption text-[var(--dpf-muted)]"
              title={data.positionTitle ?? undefined}
            >
              {data.positionTitle ?? "No position set"}
            </p>
          </div>

          <StatusBadge domain="workforceStatus" status={data.status} size="sm" />
        </div>

        <div className="flex items-center justify-between gap-2">
          <span
            className="truncate text-dpf-caption text-[var(--dpf-muted)]"
            title={data.departmentName ?? undefined}
          >
            {data.departmentName ?? "Unassigned"}
          </span>

          {data.directReports > 0 && (
            <span
              className="shrink-0 rounded px-1.5 py-0.5 text-dpf-caption text-[var(--dpf-muted)]"
              style={{ backgroundColor: "var(--dpf-surface-2)" }}
              title={`${data.directReports} direct, ${data.totalReports} total in this branch`}
            >
              {data.directReports} direct
              {data.totalReports > data.directReports ? ` · ${data.totalReports} total` : ""}
            </span>
          )}
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
}

export const OrgChartNode = memo(OrgChartNodeImpl);
