"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleCountryStatus } from "@/lib/actions/reference-data-admin";

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
};

export function CountryPanel({ countries }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(true);
  const [search, setSearch] = useState("");

  const activeCount = countries.filter((c) => c.status === "active").length;

  const filtered = countries.filter((c) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.iso2.toLowerCase().includes(q) ||
      c.iso3.toLowerCase().includes(q)
    );
  });

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
        className="flex w-full items-center justify-between text-left"
      >
        <h3 className="text-sm font-semibold text-white">
          Countries ({activeCount} active)
        </h3>
        <span className="text-[var(--dpf-muted)] text-sm">
          {open ? "\u25BE" : "\u25B8"}
        </span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by name, ISO-2, or ISO-3..."
            className="w-full rounded border px-3 py-2 text-sm bg-[var(--dpf-surface-2)] border-[var(--dpf-border)] text-[var(--dpf-foreground)] placeholder:text-[var(--dpf-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--dpf-accent)]"
          />

          <div className="space-y-1">
            {filtered.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between rounded px-3 py-2 text-sm hover:bg-[var(--dpf-surface-2)]"
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
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-xs text-[var(--dpf-muted)]">
                No countries match your filter.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
