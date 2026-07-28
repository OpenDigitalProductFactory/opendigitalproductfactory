"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleCountryStatus } from "@/lib/actions/reference-data-admin";
import {
  ReferenceDataPagination,
  ReferenceDataSearch,
} from "@/components/admin/ReferenceDataControls";
import type { PageWindow } from "@/lib/admin/reference-data-read-model";

type Country = {
  id: string;
  name: string;
  iso2: string;
  iso3: string;
  phoneCode: string;
  status: string;
  createdAt: Date;
};

type Props = {
  countries: Country[];
  query: string;
  window: PageWindow;
};

export function CountryPanel({ countries, query, window }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(true);

  function handleToggle(id: string) {
    startTransition(async () => {
      await toggleCountryStatus(id);
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="country-panel-content"
        className="flex w-full items-center justify-between text-left"
      >
        <h3 className="text-sm font-semibold text-[var(--dpf-text)]">
          Countries ({window.total.toLocaleString()} matching)
        </h3>
        <span aria-hidden="true" className="text-sm text-[var(--dpf-muted)]">
          {open ? "\u25BE" : "\u25B8"}
        </span>
      </button>

      {open && (
        <div id="country-panel-content" className="mt-3 space-y-3">
          <ReferenceDataSearch
            label="Find countries"
            query={query}
            queryParam="countryQ"
            pageParam="countryPage"
            placeholder="Filter by name, ISO-2, or ISO-3..."
          />

          <div className="space-y-1">
            {countries.map((c) => (
              <div
                key={c.id}
                className="flex flex-col gap-2 rounded px-3 py-2 text-sm hover:bg-[var(--dpf-surface-2)] sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                      c.status === "active"
                        ? "bg-green-400"
                        : "bg-[var(--dpf-muted)]"
                    }`}
                  />
                  <span className="font-medium text-[var(--dpf-foreground)]">
                    {c.name}
                  </span>
                  <span className="text-[var(--dpf-muted)]">{c.iso2}</span>
                  <span className="text-[var(--dpf-muted)]">{c.iso3}</span>
                  <span className="text-[var(--dpf-muted)]">
                    +{c.phoneCode}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggle(c.id)}
                  disabled={isPending}
                  className="shrink-0 rounded border border-[var(--dpf-border)] px-2 py-1 text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-foreground)] disabled:opacity-50"
                >
                  {c.status === "active" ? "Deactivate" : "Activate"}
                </button>
              </div>
            ))}
            {countries.length === 0 && (
              <p className="px-3 py-2 text-xs text-[var(--dpf-muted)]">
                No countries match your filter.
              </p>
            )}
          </div>
          <ReferenceDataPagination
            label="Country results"
            window={window}
            pageParam="countryPage"
          />
        </div>
      )}
    </div>
  );
}
