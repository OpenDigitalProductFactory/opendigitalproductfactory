"use client";

import Link from "next/link";

import { DataTable, StatusBadge, type Column } from "@/components/ui/report-kit";

export type AiSpendProviderTableRow = {
  id: string;
  providerId: string;
  providerName: string;
  providerStatus: string;
  supplierId: string | null;
  supplierName: string | null;
  financeStatus: "tracked" | "needs_setup" | "untracked";
  financeStatusLabel: string;
  commitmentLabel: string;
  billingLabel: string;
  coverageLabel: string;
  latestPaymentLabel: string;
  latestBillId: string | null;
  meteredSpendLabel: string;
  utilizationLabel: string;
  workItemCount: number;
  primaryWorkItemType: string | null;
  primaryWorkItemLabel: string;
};

const columns: Column<AiSpendProviderTableRow>[] = [
  {
    key: "provider",
    header: "Provider",
    cell: (row) => (
      <Link href={`/platform/ai/providers/${row.providerId}`} className="font-medium text-[var(--dpf-accent)]">
        {row.providerName}
      </Link>
    ),
    sortAccessor: (row) => row.providerName,
  },
  {
    key: "supplier",
    header: "Supplier",
    cell: (row) => row.supplierId ? (
      <Link href={`/finance/suppliers/${row.supplierId}`} className="text-[var(--dpf-accent)]">
        {row.supplierName}
      </Link>
    ) : (
      <span className="text-[var(--dpf-muted)]">Not linked</span>
    ),
    sortAccessor: (row) => row.supplierName ?? "",
  },
  {
    key: "status",
    header: "Finance status",
    cell: (row) => (
      <StatusBadge domain="aiFinance" status={row.financeStatus} label={row.financeStatusLabel} />
    ),
    sortAccessor: (row) => row.financeStatus,
  },
  {
    key: "commitment",
    header: "Commitment",
    align: "right",
    cell: (row) => row.commitmentLabel,
    sortAccessor: (row) => row.commitmentLabel,
  },
  {
    key: "billing",
    header: "Billing",
    cell: (row) => (
      <div className="space-y-1">
        <p className="text-sm text-[var(--dpf-text)]">{row.billingLabel}</p>
        <p className="text-xs text-[var(--dpf-muted)]">{row.coverageLabel}</p>
      </div>
    ),
    sortAccessor: (row) => row.billingLabel,
  },
  {
    key: "evidence",
    header: "Latest evidence",
    cell: (row) =>
      row.latestBillId ? (
        <Link href={`/finance/bills/${row.latestBillId}`} className="text-[var(--dpf-accent)]">
          {row.latestPaymentLabel}
        </Link>
      ) : (
        <span className="text-[var(--dpf-muted)]">{row.latestPaymentLabel}</span>
      ),
    sortAccessor: (row) => row.latestPaymentLabel,
  },
  {
    key: "metered",
    header: "Metered MTD",
    align: "right",
    cell: (row) => row.meteredSpendLabel,
    sortAccessor: (row) => row.meteredSpendLabel,
  },
  {
    key: "utilization",
    header: "Utilization",
    align: "right",
    cell: (row) => row.utilizationLabel,
    sortAccessor: (row) => row.utilizationLabel,
  },
  {
    key: "asks",
    header: "Employee asks",
    cell: (row) => (
      <div className="flex items-center gap-2">
        <StatusBadge
          domain="aiFinanceWork"
          status={row.primaryWorkItemType ?? "none"}
          label={row.primaryWorkItemLabel}
          variant={row.workItemCount > 0 ? "outline" : "soft"}
        />
        {row.workItemCount > 1 ? (
          <span className="text-[var(--dpf-muted)]">+{row.workItemCount - 1}</span>
        ) : null}
      </div>
    ),
    sortAccessor: (row) => row.workItemCount,
  },
];

export function AiSpendProviderTable({ rows }: { rows: AiSpendProviderTableRow[] }) {
  return (
    <DataTable
      columns={columns}
      rows={rows}
      getRowKey={(row) => row.id}
      initialSort={{ key: "status", dir: "desc" }}
      pageSize={20}
      empty="No AI provider finance records yet"
    />
  );
}
