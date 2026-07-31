// apps/web/components/ui/report-kit/DataTable.tsx
//
// Presentational, typed data table for the reporting palette. Replaces the
// hand-rolled <table> markup repeated across portal surfaces: consistent
// header styling, hover rows, right-aligned numerics, monospace ID columns,
// built-in empty + loading states, optional client-side sort and pagination.
//
// Data-source-agnostic: the caller fetches rows (often in a server component)
// and passes them in. Interactive sort/pagination make this a client
// component; a server page that wants interactivity wraps it in a thin client
// child (see README). Server-driven sort/paginate is a documented follow-up.

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

export type Align = "left" | "right" | "center";

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  align?: Align;
  /** Provide to make this column sortable. */
  sortAccessor?: (row: T) => string | number;
  /** Render cell content in a monospace font (ID/reference columns). */
  mono?: boolean;
  width?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  /** Whole-row drill-down link. */
  rowHref?: (row: T) => string;
  /** Custom empty state (defaults to a muted "No records" row). */
  empty?: React.ReactNode;
  loading?: boolean;
  initialSort?: { key: string; dir: SortDir };
  /** Enable client-side pagination at this page size. Omit for no paging. */
  pageSize?: number;
  dense?: boolean;
  className?: string;
}

export type SortDir = "asc" | "desc";

// ---------------------------------------------------------------------------
// Pure helpers — exported so logic is unit-testable without a DOM.
// ---------------------------------------------------------------------------

/** Stable sort `rows` by `accessor`. Strings compare locale-insensitively. */
export function sortRows<T>(
  rows: T[],
  accessor: (row: T) => string | number,
  dir: SortDir,
): T[] {
  const factor = dir === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const av = accessor(a.row);
      const bv = accessor(b.row);
      let cmp: number;
      if (typeof av === "number" && typeof bv === "number") {
        cmp = av - bv;
      } else {
        cmp = String(av).localeCompare(String(bv));
      }
      // Stable: fall back to original index on ties.
      return cmp !== 0 ? cmp * factor : a.index - b.index;
    })
    .map((entry) => entry.row);
}

/** Slice `rows` for a 0-based page index at `pageSize`. */
export function paginateRows<T>(rows: T[], page: number, pageSize: number): T[] {
  const start = page * pageSize;
  return rows.slice(start, start + pageSize);
}

/** Total number of pages for `total` rows at `pageSize` (min 1). */
export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

// ---------------------------------------------------------------------------

const ALIGN_CLASS: Record<Align, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  rowHref,
  empty,
  loading = false,
  initialSort,
  pageSize,
  dense = false,
  className = "",
}: DataTableProps<T>) {
  const [sort, setSort] = useState<{ key: string; dir: SortDir } | null>(
    initialSort ?? null,
  );
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortAccessor) return rows;
    return sortRows(rows, col.sortAccessor, sort.dir);
  }, [rows, sort, columns]);

  const total = sorted.length;
  const pages = pageSize ? pageCount(total, pageSize) : 1;
  const clampedPage = Math.min(page, pages - 1);
  const visible = pageSize
    ? paginateRows(sorted, clampedPage, pageSize)
    : sorted;

  const cellPad = dense ? "px-2 py-1" : "px-3 py-2";

  function toggleSort(col: Column<T>) {
    if (!col.sortAccessor) return;
    setSort((prev) => {
      if (prev?.key !== col.key) return { key: col.key, dir: "asc" };
      return { key: col.key, dir: prev.dir === "asc" ? "desc" : "asc" };
    });
    setPage(0);
  }

  return (
    <div className={className}>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-[var(--dpf-border)] text-left">
            {columns.map((col) => {
              const sortable = Boolean(col.sortAccessor);
              const active = sort?.key === col.key;
              return (
                <th
                  key={col.key}
                  scope="col"
                  style={col.width ? { width: col.width } : undefined}
                  className={[
                    cellPad,
                    "font-medium uppercase tracking-wide text-[var(--dpf-muted)]",
                    ALIGN_CLASS[col.align ?? "left"],
                    sortable ? "cursor-pointer select-none" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={sortable ? () => toggleSort(col) : undefined}
                  aria-sort={
                    active ? (sort?.dir === "asc" ? "ascending" : "descending") : undefined
                  }
                >
                  <span className="inline-flex items-center gap-1">
                    {col.header}
                    {sortable ? (
                      <span aria-hidden="true" className="text-[8px]">
                        {active ? (sort?.dir === "asc" ? "▲" : "▼") : "↕"}
                      </span>
                    ) : null}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: pageSize ?? 3 }).map((_, i) => (
              <tr key={`skeleton-${i}`} className="border-b border-[var(--dpf-border)]">
                {columns.map((col) => (
                  <td key={col.key} className={cellPad}>
                    <span className="block h-3 w-2/3 animate-pulse rounded bg-[var(--dpf-surface-2)]" />
                  </td>
                ))}
              </tr>
            ))
          ) : visible.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className={`${cellPad} text-center text-[var(--dpf-muted)]`}
              >
                {empty ?? "No records"}
              </td>
            </tr>
          ) : (
            visible.map((row) => {
              const href = rowHref?.(row);
              return (
                <tr
                  key={getRowKey(row)}
                  className="border-b border-[var(--dpf-border)] hover:bg-[var(--dpf-surface-2)]"
                >
                  {columns.map((col) => {
                    const content = col.cell(row);
                    return (
                      <td
                        key={col.key}
                        className={[
                          cellPad,
                          ALIGN_CLASS[col.align ?? "left"],
                          col.mono ? "font-mono text-[var(--dpf-text-secondary)]" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        {href ? (
                          <Link href={href} className="block">
                            {content}
                          </Link>
                        ) : (
                          content
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      {pageSize && pages > 1 && !loading ? (
        <div className="mt-2 flex items-center justify-between text-[10px] text-[var(--dpf-muted)]">
          <span>
            {total} record{total === 1 ? "" : "s"} · page {clampedPage + 1} of {pages}
          </span>
          <span className="flex gap-1">
            <button
              type="button"
              className="rounded border border-[var(--dpf-border)] px-2 py-0.5 disabled:opacity-40"
              disabled={clampedPage <= 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Prev
            </button>
            <button
              type="button"
              className="rounded border border-[var(--dpf-border)] px-2 py-0.5 disabled:opacity-40"
              disabled={clampedPage >= pages - 1}
              onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
            >
              Next
            </button>
          </span>
        </div>
      ) : null}
    </div>
  );
}
