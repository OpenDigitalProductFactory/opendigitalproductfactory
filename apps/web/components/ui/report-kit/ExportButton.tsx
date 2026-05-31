// apps/web/components/ui/report-kit/ExportButton.tsx
//
// CSV export for the reporting palette. Wires up papaparse (already a
// dependency but previously unused) so any list/table surface can offer a
// "Export CSV" affordance. Pairs naturally with DataTable.

"use client";

import Papa from "papaparse";

export interface ExportColumn {
  key: string;
  /** Column header in the CSV (defaults to `key`). */
  header?: string;
}

export interface ExportButtonProps {
  rows: Record<string, unknown>[];
  /** Optional projection + ordering + headers. Omit to export all keys as-is. */
  columns?: ExportColumn[];
  filename?: string;
  label?: string;
  className?: string;
}

/**
 * Serialize rows to a CSV string. Pure (no DOM) so it is unit-testable.
 * When `columns` are given, only those keys are emitted, in order, using the
 * provided headers.
 */
export function toCsv(
  rows: Record<string, unknown>[],
  columns?: ExportColumn[],
): string {
  if (!columns || columns.length === 0) {
    return Papa.unparse(rows);
  }
  const fields = columns.map((c) => c.header ?? c.key);
  const data = rows.map((row) => columns.map((c) => row[c.key] ?? ""));
  return Papa.unparse({ fields, data });
}

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function ExportButton({
  rows,
  columns,
  filename = "export.csv",
  label = "Export CSV",
  className = "",
}: ExportButtonProps) {
  const disabled = rows.length === 0;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => downloadCsv(toCsv(rows, columns), filename)}
      className={[
        "rounded border border-[var(--dpf-border)] px-2.5 py-1 text-[11px] font-medium text-[var(--dpf-muted)]",
        "transition-colors hover:text-[var(--dpf-text)] disabled:opacity-40 disabled:cursor-not-allowed",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {label}
    </button>
  );
}
