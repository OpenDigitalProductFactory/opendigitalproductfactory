// apps/web/app/(shell)/finance/assets/AssetsTable.tsx
//
// Client wrapper rendering the report-kit DataTable for fixed assets. The page
// (a Server Component) fetches + serializes rows and passes them here. The
// depreciation progress bar is a small presentational child rendered per row.

"use client";

import Link from "next/link";

import {
  DataTable,
  ExportButton,
  StatusBadge,
  type Column,
} from "@/components/ui/report-kit";

export interface AssetRow {
  id: string;
  assetId: string;
  name: string;
  category: string;
  purchaseCost: number;
  currentBookValue: number;
  pctDepreciated: number;
  status: string;
}

function formatMoney(amount: number): string {
  return amount.toLocaleString("en-GB", { minimumFractionDigits: 2 });
}

function DepreciationBar({ pct }: { pct: number }) {
  const colour =
    pct >= 80
      ? "var(--dpf-error)"
      : pct >= 50
        ? "var(--dpf-warning)"
        : "var(--dpf-success)";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-[var(--dpf-border)] overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: colour }}
        />
      </div>
      <span className="text-[9px] text-[var(--dpf-muted)] w-8 text-right">
        {pct.toFixed(0)}%
      </span>
    </div>
  );
}

export function AssetsTable({
  rows,
  currencySymbol,
}: {
  rows: AssetRow[];
  currencySymbol: string;
}) {
  const columns: Column<AssetRow>[] = [
    {
      key: "assetId",
      header: "Asset ID",
      cell: (a) => (
        <Link
          href={`/finance/assets/${a.id}`}
          className="text-[9px] font-mono text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] transition-colors"
        >
          {a.assetId}
        </Link>
      ),
      sortAccessor: (a) => a.assetId,
    },
    {
      key: "name",
      header: "Name",
      cell: (a) => (
        <Link
          href={`/finance/assets/${a.id}`}
          className="text-[var(--dpf-text)] hover:underline"
        >
          {a.name}
        </Link>
      ),
      sortAccessor: (a) => a.name,
    },
    {
      key: "category",
      header: "Category",
      cell: (a) => (
        <StatusBadge
          domain="financeAssetCategory"
          status={a.category}
          variant="soft"
          uppercase={false}
        />
      ),
      sortAccessor: (a) => a.category,
    },
    {
      key: "purchaseCost",
      header: "Purchase Cost",
      align: "right",
      cell: (a) => (
        <span className="text-[var(--dpf-text)]">
          {currencySymbol}
          {formatMoney(a.purchaseCost)}
        </span>
      ),
      sortAccessor: (a) => a.purchaseCost,
    },
    {
      key: "bookValue",
      header: "Book Value",
      align: "right",
      cell: (a) => (
        <span className="text-[var(--dpf-text)]">
          {currencySymbol}
          {formatMoney(a.currentBookValue)}
        </span>
      ),
      sortAccessor: (a) => a.currentBookValue,
    },
    {
      key: "depreciated",
      header: "Depreciated",
      width: "10rem",
      cell: (a) => <DepreciationBar pct={a.pctDepreciated} />,
      sortAccessor: (a) => a.pctDepreciated,
    },
    {
      key: "status",
      header: "Status",
      cell: (a) => (
        <StatusBadge
          domain="financeAsset"
          status={a.status}
          label={a.status.replace(/_/g, " ")}
          variant="soft"
          uppercase={false}
        />
      ),
      sortAccessor: (a) => a.status,
    },
  ];

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <ExportButton
          rows={rows.map((a) => ({
            assetId: a.assetId,
            name: a.name,
            category: a.category,
            purchaseCost: a.purchaseCost,
            bookValue: a.currentBookValue,
            depreciatedPct: Number(a.pctDepreciated.toFixed(0)),
            status: a.status,
          }))}
          columns={[
            { key: "assetId", header: "Asset ID" },
            { key: "name", header: "Name" },
            { key: "category", header: "Category" },
            { key: "purchaseCost", header: "Purchase Cost" },
            { key: "bookValue", header: "Book Value" },
            { key: "depreciatedPct", header: "Depreciated %" },
            { key: "status", header: "Status" },
          ]}
          filename="assets.csv"
        />
      </div>
      <div className="rounded-lg border border-[var(--dpf-border)] overflow-hidden">
        <DataTable
          columns={columns}
          rows={rows}
          getRowKey={(a) => a.id}
          empty="No assets found."
        />
      </div>
    </div>
  );
}
