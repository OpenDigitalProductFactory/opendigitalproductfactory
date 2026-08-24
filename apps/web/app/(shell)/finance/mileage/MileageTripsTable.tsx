"use client";

// Driver-facing trip list with one-gesture classification.
//
// The classification control is the whole product for a driver: capture is
// automatic, so the only thing they ever do is say business or personal.
// Anything slower than a single click defeats the feature.
//
// Composes the shared report-kit DataTable and the ui/Button primitive rather
// than hand-rolling a table and accent buttons (AGENTS.md §9).

import { useState, useTransition } from "react";
import { DataTable, type Column } from "@/components/ui/report-kit/DataTable";
import { Button } from "@/components/ui/Button";
import { classifyTripAction } from "@/lib/actions/mileage";
import type { TripClassification } from "@/lib/mileage/classification";

export type MileageTripRow = {
  tripId: string;
  startedAtISO: string;
  miles: number;
  route: string;
  classification: TripClassification;
  classifiedBy: string | null;
  amount: number | null;
  claimed: boolean;
};

const CHOICES: ReadonlyArray<{ value: TripClassification; label: string }> = [
  { value: "business", label: "Business" },
  { value: "personal", label: "Personal" },
  { value: "commute", label: "Commute" },
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function MileageTripsTable({
  rows,
  currencySymbol,
}: {
  rows: MileageTripRow[];
  currencySymbol: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busyTripId, setBusyTripId] = useState<string | null>(null);

  function classify(tripId: string, value: TripClassification) {
    setError(null);
    setBusyTripId(tripId);
    startTransition(async () => {
      const res = await classifyTripAction(tripId, value);
      if (!res.ok) setError(res.error);
      setBusyTripId(null);
    });
  }

  const columns: Column<MileageTripRow>[] = [
    {
      key: "date",
      header: "Date",
      cell: (row) => formatDate(row.startedAtISO),
      sortAccessor: (row) => row.startedAtISO,
    },
    { key: "route", header: "Route", cell: (row) => row.route },
    {
      key: "miles",
      header: "Miles",
      align: "right",
      cell: (row) => row.miles.toFixed(1),
      sortAccessor: (row) => row.miles,
    },
    {
      key: "classification",
      header: "Sorted",
      cell: (row) =>
        row.claimed ? (
          // A claimed drive is accounting evidence — its classification must
          // not change after the money moved.
          <span className="text-xs text-[var(--dpf-muted)]">{row.classification} · paid</span>
        ) : (
          <div className="flex gap-1">
            {CHOICES.map((choice) => (
              <Button
                key={choice.value}
                type="button"
                size="sm"
                variant={row.classification === choice.value ? "primary" : "secondary"}
                aria-pressed={row.classification === choice.value}
                disabled={pending && busyTripId === row.tripId}
                onClick={() => classify(row.tripId, choice.value)}
              >
                {choice.label}
              </Button>
            ))}
          </div>
        ),
    },
    {
      key: "amount",
      header: "Owed",
      align: "right",
      cell: (row) =>
        // An unpriced drive shows a placeholder, never a zero — "not yet
        // priced" must not read as "nothing owed".
        row.amount === null ? (
          <span className="text-[var(--dpf-muted)]">—</span>
        ) : (
          `${currencySymbol}${row.amount.toFixed(2)}`
        ),
      sortAccessor: (row) => row.amount ?? -1,
    },
  ];

  return (
    <div className="space-y-3">
      {error ? (
        <div
          role="alert"
          className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface)] px-3 py-2 text-sm text-[var(--dpf-danger)]"
        >
          {error}
        </div>
      ) : null}

      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.tripId}
        ariaLabel="Your drives"
        initialSort={{ key: "date", dir: "desc" }}
        empty={
          <div className="p-6 text-center text-sm text-[var(--dpf-muted)]">
            No drives yet. Turn it on in the app.
          </div>
        }
      />
    </div>
  );
}
