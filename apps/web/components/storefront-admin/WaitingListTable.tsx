"use client";

// The adoption waiting list's table (BI-899D7F00), composed from the shared
// report-kit DataTable so the storefront admin does not grow a second table
// idiom. Rows arrive already ordered and already serialised by the server
// page; nothing here sorts, pages or filters — the owner decided against all
// three, and the wait order is the point.

import { DataTable, type Column } from "@/components/ui/report-kit";

export interface WaitingListTableRow {
  id: string;
  name: string;
  species: string | null;
  breed: string | null;
  /** Already formatted for the reader, e.g. "1 Aug 2026", "No date", "Date is in the future". */
  listedOn: string;
  /** Whole days, or null when the date is missing or in the future. */
  daysWaiting: number | null;
  /** True when the listing date is missing or in the future. */
  flagged: boolean;
}

function speciesLabel(species: string | null): string {
  if (!species) return "Not set";
  return species.charAt(0).toUpperCase() + species.slice(1);
}

const COLUMNS: Column<WaitingListTableRow>[] = [
  { key: "name", header: "Name", cell: (row) => <span className="font-medium">{row.name}</span> },
  { key: "species", header: "Species", cell: (row) => speciesLabel(row.species) },
  { key: "breed", header: "Breed", cell: (row) => row.breed ?? "—" },
  {
    key: "listedOn",
    header: "Listed on",
    cell: (row) => (
      <span className={row.flagged ? "text-[var(--dpf-warning)]" : undefined}>{row.listedOn}</span>
    ),
  },
  {
    key: "daysWaiting",
    header: "Days waiting",
    align: "right",
    cell: (row) => (row.daysWaiting === null ? "—" : String(row.daysWaiting)),
  },
];

export function WaitingListTable({ rows, label }: { rows: WaitingListTableRow[]; label: string }) {
  return <DataTable columns={COLUMNS} rows={rows} getRowKey={(row) => row.id} ariaLabel={label} dense />;
}
