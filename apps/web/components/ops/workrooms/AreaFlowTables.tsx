"use client";

import Link from "next/link";

import { DataTable, type Column } from "@/components/ui/report-kit";

/** One work shape's row in an area's flow table; every cell arrives formatted from the server. */
export type ShapeFlowTableRow = { key: string; href: string; title: string; inFlow: number; flowTime: string; waits: string };

export function ShapeFlowTable({
  rows,
  headers,
  ariaLabel,
}: {
  rows: ShapeFlowTableRow[];
  headers: { shape: string; inFlow: string; flowTime: string; waits: string };
  ariaLabel: string;
}) {
  const columns: Column<ShapeFlowTableRow>[] = [
    { key: "shape", header: headers.shape, cell: (row) => <Link className="text-[var(--dpf-accent)] hover:underline" href={row.href}>{row.title}</Link> },
    { key: "inFlow", header: headers.inFlow, align: "right", cell: (row) => row.inFlow, sortAccessor: (row) => row.inFlow },
    { key: "flowTime", header: headers.flowTime, cell: (row) => row.flowTime },
    { key: "waits", header: headers.waits, cell: (row) => <span className="text-[var(--dpf-text-secondary)]">{row.waits}</span> },
  ];
  return <DataTable columns={columns} rows={rows} getRowKey={(row) => row.key} dense ariaLabel={ariaLabel} />;
}

/** One measure across the four portfolios and the unplaced rooms. */
export type PortfolioComparisonRow = { key: string; measure: string; values: string[] };

export function PortfolioComparisonTable({
  rows,
  portfolios,
  measureHeader,
  ariaLabel,
}: {
  rows: PortfolioComparisonRow[];
  portfolios: { key: string; label: string; href: string | null }[];
  measureHeader: string;
  ariaLabel: string;
}) {
  const columns: Column<PortfolioComparisonRow>[] = [
    { key: "measure", header: <span className="sr-only">{measureHeader}</span>, cell: (row) => <span className="text-[var(--dpf-text-secondary)]">{row.measure}</span> },
    ...portfolios.map((portfolio, index): Column<PortfolioComparisonRow> => ({
      key: portfolio.key,
      header: portfolio.href ? <Link className="text-[var(--dpf-accent)] hover:underline" href={portfolio.href}>{portfolio.label}</Link> : portfolio.label,
      align: "right",
      cell: (row) => row.values[index],
    })),
  ];
  return <DataTable columns={columns} rows={rows} getRowKey={(row) => row.key} dense ariaLabel={ariaLabel} />;
}
