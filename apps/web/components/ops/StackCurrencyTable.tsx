"use client";

import { DataTable, StatusBadge, type Column } from "@/components/ui/report-kit";
import type { AssessedStackComponent, StackCurrency } from "@/lib/ops/platform-stack";

const CURRENCY_INTENT: Record<StackCurrency, "success" | "warning" | "danger" | "neutral"> = {
  current: "success",
  "approaching-eol": "warning",
  unsupported: "danger",
  "end-of-life": "danger",
  unsourced: "neutral",
};

const CURRENCY_LABEL: Record<StackCurrency, string> = {
  current: "Current",
  "approaching-eol": "Approaching EOL",
  unsupported: "Unsupported",
  "end-of-life": "End of life",
  unsourced: "EOL not sourced",
};

// Order used when sorting by currency: most-urgent first.
const CURRENCY_ORDER: Record<StackCurrency, number> = {
  "end-of-life": 0,
  unsupported: 1,
  "approaching-eol": 2,
  unsourced: 3,
  current: 4,
};

const COLUMNS: Column<AssessedStackComponent>[] = [
  {
    key: "name",
    header: "Component",
    sortAccessor: (r) => r.name,
    cell: (r) => (
      <a href={r.referenceUrl} target="_blank" rel="noreferrer" className="hover:underline">
        {r.name}
      </a>
    ),
  },
  { key: "category", header: "Category", sortAccessor: (r) => r.category, cell: (r) => r.category },
  { key: "version", header: "Version", mono: true, cell: (r) => r.currentVersion },
  {
    key: "currency",
    header: "Currency",
    sortAccessor: (r) => CURRENCY_ORDER[r.currency],
    cell: (r) => <StatusBadge intent={CURRENCY_INTENT[r.currency]} label={CURRENCY_LABEL[r.currency]} />,
  },
  {
    key: "supportEndsAt",
    header: "Support ends",
    sortAccessor: (r) => r.supportEndsAt ?? "￿",
    cell: (r) =>
      r.supportEndsAt
        ? `${r.supportEndsAt}${r.daysUntilEol != null ? ` · ${r.daysUntilEol}d` : ""}`
        : "—",
  },
];

export function StackCurrencyTable({ rows }: { rows: AssessedStackComponent[] }) {
  return (
    <DataTable
      columns={COLUMNS}
      rows={rows}
      getRowKey={(r) => r.key}
      initialSort={{ key: "currency", dir: "asc" }}
      ariaLabel="Platform stack currency"
    />
  );
}
