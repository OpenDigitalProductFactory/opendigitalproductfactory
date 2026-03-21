"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateCity,
  toggleCityStatus,
} from "@/lib/actions/reference-data-admin";
import { forceCreateCity } from "@/lib/actions/reference-data";

type City = {
  id: string;
  name: string;
  status: string;
  region: {
    id: string;
    name: string;
    code: string | null;
    countryId: string;
    country: { id: string; name: string; iso2: string };
  };
};

type CountryOption = { id: string; name: string; iso2: string };
type RegionOption = { id: string; name: string; countryId: string };

type Props = {
  cities: City[];
  countries: CountryOption[];
  regions: RegionOption[];
};

const inputCls =
  "w-full rounded border px-3 py-2 text-sm bg-[var(--dpf-surface-2)] border-[var(--dpf-border)] text-[var(--dpf-foreground)] placeholder:text-[var(--dpf-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--dpf-accent)]";

export function CityPanel({ cities, countries, regions }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(true);
  const [countryFilter, setCountryFilter] = useState<string>("");
  const [regionFilter, setRegionFilter] = useState<string>("");

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  // Add form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [addName, setAddName] = useState("");
  const [addCountryId, setAddCountryId] = useState(countries[0]?.id ?? "");
  const [addRegionId, setAddRegionId] = useState("");

  const activeCount = cities.filter((c) => c.status === "active").length;

  // Cascading filter
  const filteredByCountry = countryFilter
    ? cities.filter((c) => c.region.countryId === countryFilter)
    : cities;

  const filtered = regionFilter
    ? filteredByCountry.filter((c) => c.region.id === regionFilter)
    : filteredByCountry;

  // Regions scoped to selected country filter
  const filteredRegions = countryFilter
    ? regions.filter((r) => r.countryId === countryFilter)
    : regions;

  // Regions scoped to add form country
  const addFormRegions = regions.filter((r) => r.countryId === addCountryId);

  function startEdit(c: City) {
    setEditingId(c.id);
    setEditName(c.name);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName("");
  }

  function saveEdit(id: string) {
    startTransition(async () => {
      await updateCity(id, { name: editName });
      setEditingId(null);
      router.refresh();
    });
  }

  function handleToggle(id: string) {
    startTransition(async () => {
      await toggleCityStatus(id);
      router.refresh();
    });
  }

  function handleAdd() {
    if (!addName.trim() || !addRegionId) return;
    startTransition(async () => {
      await forceCreateCity(addRegionId, addName.trim());
      setAddName("");
      setAddRegionId("");
      setShowAddForm(false);
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
        <h3 className="text-sm font-semibold text-[var(--dpf-text)]">
          Cities ({activeCount} active)
        </h3>
        <span className="text-[var(--dpf-muted)] text-sm">
          {open ? "\u25BE" : "\u25B8"}
        </span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {/* Cascading filters */}
          <div className="flex gap-2">
            <select
              value={countryFilter}
              onChange={(e) => {
                setCountryFilter(e.target.value);
                setRegionFilter("");
              }}
              className={inputCls}
            >
              <option value="">All countries</option>
              {countries.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.iso2})
                </option>
              ))}
            </select>
            <select
              value={regionFilter}
              onChange={(e) => setRegionFilter(e.target.value)}
              className={inputCls}
              disabled={!countryFilter}
            >
              <option value="">All regions</option>
              {filteredRegions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            {filtered.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between rounded px-3 py-2 text-sm hover:bg-[var(--dpf-surface-2)]"
              >
                {editingId === c.id ? (
                  <div className="flex flex-1 items-center gap-2">
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveEdit(c.id);
                        if (e.key === "Escape") cancelEdit();
                      }}
                      className="rounded border px-2 py-1 text-sm bg-[var(--dpf-surface-2)] border-[var(--dpf-border)] text-[var(--dpf-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--dpf-accent)]"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => saveEdit(c.id)}
                      disabled={isPending}
                      className="text-xs text-green-400 hover:text-green-300 disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-foreground)]"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
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
                    <span className="text-[var(--dpf-muted)]">
                      {c.region.name}
                    </span>
                    <span className="text-[var(--dpf-muted)]">
                      {c.region.country.name}
                    </span>
                  </div>
                )}

                <div className="flex shrink-0 items-center gap-2">
                  {editingId !== c.id && (
                    <button
                      type="button"
                      onClick={() => startEdit(c)}
                      className="text-sm text-[var(--dpf-muted)] hover:text-[var(--dpf-accent)]"
                      title="Edit city"
                    >
                      &#9998;
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleToggle(c.id)}
                    disabled={isPending}
                    className="rounded border border-[var(--dpf-border)] px-2 py-1 text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-foreground)] disabled:opacity-50"
                  >
                    {c.status === "active" ? "Deactivate" : "Activate"}
                  </button>
                </div>
              </div>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-xs text-[var(--dpf-muted)]">
                No cities to display.
              </p>
            )}
          </div>

          {/* Add city form */}
          {!showAddForm ? (
            <button
              type="button"
              onClick={() => setShowAddForm(true)}
              className="rounded border border-[var(--dpf-border)] px-3 py-1.5 text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-foreground)]"
            >
              + Add city
            </button>
          ) : (
            <div className="flex items-center gap-2 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
              <input
                type="text"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                placeholder="City name"
                className="rounded border px-2 py-1 text-sm bg-[var(--dpf-surface-2)] border-[var(--dpf-border)] text-[var(--dpf-foreground)] placeholder:text-[var(--dpf-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--dpf-accent)]"
                autoFocus
              />
              <select
                value={addCountryId}
                onChange={(e) => {
                  setAddCountryId(e.target.value);
                  setAddRegionId("");
                }}
                className="rounded border px-2 py-1 text-sm bg-[var(--dpf-surface-2)] border-[var(--dpf-border)] text-[var(--dpf-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--dpf-accent)]"
              >
                {countries.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.iso2})
                  </option>
                ))}
              </select>
              <select
                value={addRegionId}
                onChange={(e) => setAddRegionId(e.target.value)}
                className="rounded border px-2 py-1 text-sm bg-[var(--dpf-surface-2)] border-[var(--dpf-border)] text-[var(--dpf-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--dpf-accent)]"
              >
                <option value="">Select region</option>
                {addFormRegions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleAdd}
                disabled={isPending || !addName.trim() || !addRegionId}
                className="rounded bg-[var(--dpf-accent)] px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
              >
                {isPending ? "..." : "Add"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddForm(false);
                  setAddName("");
                  setAddRegionId("");
                }}
                className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-foreground)]"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
