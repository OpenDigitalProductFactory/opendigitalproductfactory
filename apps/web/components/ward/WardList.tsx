"use client";

// The ward as a table. The map answers "how much room is left" at a glance;
// this answers "what is the state of unit C1-2" without relying on position or
// colour alone, which is why the board offers both rather than choosing.

import { DataTable, type Column } from "@/components/ui/report-kit";

export interface WardListRow {
  kennelId: string;
  label: string;
  area: string;
  animalName: string | null;
  state: "occupied" | "free" | "out-of-service";
  blockedReason: string | null;
}

function stateLabel(row: WardListRow): string {
  if (row.state === "out-of-service") return row.blockedReason ?? "Out of service";
  if (row.state === "occupied") return "Occupied";
  return "Free";
}

const COLUMNS: Column<WardListRow>[] = [
  {
    key: "label",
    header: "Unit",
    cell: (row) => row.label,
    // Units are counted, not spelled: D2 sorts before D10.
    sortAccessor: (row) => Number(row.label.replace(/\D+/g, "")) || row.label,
    mono: true,
  },
  {
    key: "area",
    header: "Area",
    cell: (row) => row.area,
    sortAccessor: (row) => row.area,
  },
  {
    key: "animal",
    header: "Animal",
    cell: (row) => row.animalName ?? "—",
    sortAccessor: (row) => row.animalName ?? "",
  },
  {
    key: "state",
    header: "State",
    cell: stateLabel,
    sortAccessor: stateLabel,
  },
];

export function WardList({ rows }: { rows: WardListRow[] }) {
  return (
    <DataTable
      columns={COLUMNS}
      rows={rows}
      getRowKey={(row) => row.kennelId}
      initialSort={{ key: "label", dir: "asc" }}
      ariaLabel="Ward units"
    />
  );
}
