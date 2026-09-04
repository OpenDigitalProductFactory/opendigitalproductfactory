"use client";

import { DataTable, StatusBadge, type Column, type Intent } from "@/components/ui/report-kit";

export type TopToolRow = {
  toolName: string;
  count: number;
  successRate: number;
};

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function successIntent(value: number): Intent {
  if (value >= 0.9) return "success";
  if (value >= 0.7) return "warning";
  return "danger";
}

const COLUMNS: Column<TopToolRow>[] = [
  {
    key: "tool",
    header: "Tool",
    cell: (row) => row.toolName,
    sortAccessor: (row) => row.toolName,
    mono: true,
  },
  {
    key: "executions",
    header: "Executions",
    cell: (row) => row.count,
    sortAccessor: (row) => row.count,
    align: "right",
    width: "7rem",
  },
  {
    key: "success",
    header: "Success rate",
    cell: (row) => (
      <StatusBadge
        intent={successIntent(row.successRate)}
        label={pct(row.successRate)}
        uppercase={false}
      />
    ),
    sortAccessor: (row) => row.successRate,
    align: "right",
    width: "8rem",
  },
];

export function TopToolsTable({ rows }: { rows: TopToolRow[] }) {
  return (
    <DataTable
      ariaLabel="Top tools"
      columns={COLUMNS}
      rows={rows}
      getRowKey={(row) => row.toolName}
      initialSort={{ key: "executions", dir: "desc" }}
      dense
    />
  );
}
