"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateRegion,
  toggleRegionStatus,
} from "@/lib/actions/reference-data-admin";
import { forceCreateRegion } from "@/lib/actions/reference-data";

type Region = {
  id: string;
  name: string;
  code: string | null;
  status: string;
  countryId: string;
  createdAt: Date;
  country: { id: string; name: string; iso2: string };
};

type CountryOption = { id: string; name: string; iso2: string };

type Props = {
  regions: Region[];
  countries: CountryOption[];
};

const inputCls =
  "w-full rounded border px-3 py-2 text-sm bg-[var(--dpf-surface-2)] border-[var(--dpf-border)] text-[var(--dpf-foreground)] placeholder:text-[var(--dpf-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--dpf-accent)]";

export function RegionPanel({ regions, countries }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(true);
  const [countryFilter, setCountryFilter] = useState<string>("");

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCode, setEditCode] = useState("");

  // Add form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [addName, setAddName] = useState("");
  const [addCode, setAddCode] = useState("");
  const [addCountryId, setAddCountryId] = useState(countries[0]?.id ?? "");

  const activeCount = regions.filter((r) => r.status === "active").length;

  const filtered = countryFilter
    ? regions.filter((r) => r.countryId === countryFilter)
    : regions;

  function startEdit(r: Region) {
    setEditingId(r.id);
    setEditName(r.name);
    setEditCode(r.code ?? "");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName("");
    setEditCode("");
  }

  function saveEdit(id: string) {
    startTransition(async () => {
      await updateRegion(id, { name: editName, code: editCode });
      setEditingId(null);
      router.refresh();
    });
  }

  function handleToggle(id: string) {
    startTransition(async () => {
      await toggleRegionStatus(id);
      router.refresh();
    });
  }

  function handleAdd() {
    if (!addName.trim() || !addCountryId) return;
    startTransition(async () => {
      await forceCreateRegion(
        addCountryId,
        addName.trim(),
        addCode.trim() || undefined,
      );
      setAddName("");
      setAddCode("");
      setShowAddForm(false);
      router.refresh();
    });
  }

  function formatDate(d: Date): string {
    return new Date(d).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
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
          Regions ({activeCount} active)
        </h3>
        <span className="text-[var(--dpf-muted)] text-sm">
          {open ? "\u25BE" : "\u25B8"}
        </span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <select
            value={countryFilter}
            onChange={(e) => setCountryFilter(e.target.value)}
            className={inputCls}
          >
            <option value="">All countries</option>
            {countries.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.iso2})
              </option>
            ))}
          </select>

          <div className="space-y-1">
            {filtered.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between rounded px-3 py-2 text-sm hover:bg-[var(--dpf-surface-2)]"
              >
                {editingId === r.id ? (
                  <div className="flex flex-1 items-center gap-2">
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveEdit(r.id);
                        if (e.key === "Escape") cancelEdit();
                      }}
                      className="rounded border px-2 py-1 text-sm bg-[var(--dpf-surface-2)] border-[var(--dpf-border)] text-[var(--dpf-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--dpf-accent)]"
                      autoFocus
                    />
                    <input
                      type="text"
                      value={editCode}
                      onChange={(e) => setEditCode(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveEdit(r.id);
                        if (e.key === "Escape") cancelEdit();
                      }}
                      placeholder="Code"
                      className="w-20 rounded border px-2 py-1 text-sm bg-[var(--dpf-surface-2)] border-[var(--dpf-border)] text-[var(--dpf-foreground)] placeholder:text-[var(--dpf-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--dpf-accent)]"
                    />
                    <button
                      type="button"
                      onClick={() => saveEdit(r.id)}
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
                        r.status === "active"
                          ? "bg-green-400"
                          : "bg-[var(--dpf-muted)]"
                      }`}
                    />
                    <span className="font-medium text-[var(--dpf-foreground)]">
                      {r.name}
                    </span>
                    {r.code && (
                      <span className="text-[var(--dpf-muted)]">{r.code}</span>
                    )}
                    <span className="text-[var(--dpf-muted)]">
                      {r.country.name}
                    </span>
                    <span className="text-xs text-[var(--dpf-muted)]">
                      {formatDate(r.createdAt)}
                    </span>
                  </div>
                )}

                <div className="flex shrink-0 items-center gap-2">
                  {editingId !== r.id && (
                    <button
                      type="button"
                      onClick={() => startEdit(r)}
                      className="text-sm text-[var(--dpf-muted)] hover:text-[var(--dpf-accent)]"
                      title="Edit region"
                    >
                      &#9998;
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleToggle(r.id)}
                    disabled={isPending}
                    className="rounded border border-[var(--dpf-border)] px-2 py-1 text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-foreground)] disabled:opacity-50"
                  >
                    {r.status === "active" ? "Deactivate" : "Activate"}
                  </button>
                </div>
              </div>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-xs text-[var(--dpf-muted)]">
                No regions to display.
              </p>
            )}
          </div>

          {/* Add region form */}
          {!showAddForm ? (
            <button
              type="button"
              onClick={() => setShowAddForm(true)}
              className="rounded border border-[var(--dpf-border)] px-3 py-1.5 text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-foreground)]"
            >
              + Add region
            </button>
          ) : (
            <div className="flex items-center gap-2 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
              <input
                type="text"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                placeholder="Region name"
                className="rounded border px-2 py-1 text-sm bg-[var(--dpf-surface-2)] border-[var(--dpf-border)] text-[var(--dpf-foreground)] placeholder:text-[var(--dpf-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--dpf-accent)]"
                autoFocus
              />
              <input
                type="text"
                value={addCode}
                onChange={(e) => setAddCode(e.target.value)}
                placeholder="Code"
                className="w-20 rounded border px-2 py-1 text-sm bg-[var(--dpf-surface-2)] border-[var(--dpf-border)] text-[var(--dpf-foreground)] placeholder:text-[var(--dpf-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--dpf-accent)]"
              />
              <select
                value={addCountryId}
                onChange={(e) => setAddCountryId(e.target.value)}
                className="rounded border px-2 py-1 text-sm bg-[var(--dpf-surface-2)] border-[var(--dpf-border)] text-[var(--dpf-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--dpf-accent)]"
              >
                {countries.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.iso2})
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleAdd}
                disabled={isPending || !addName.trim()}
                className="rounded bg-[var(--dpf-accent)] px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
              >
                {isPending ? "..." : "Add"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddForm(false);
                  setAddName("");
                  setAddCode("");
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
