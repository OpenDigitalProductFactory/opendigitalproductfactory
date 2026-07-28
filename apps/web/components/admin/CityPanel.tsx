"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateCity,
  toggleCityStatus,
  previewCityMerge,
  mergeCity,
  searchAdminRegions,
  searchCityMergeCandidates,
  type MergePreview,
} from "@/lib/actions/reference-data-admin";
import { forceCreateCity } from "@/lib/actions/reference-data";
import { ReferenceTypeahead } from "@/components/ui/ReferenceTypeahead";
import {
  ReferenceDataPagination,
  ReferenceDataParentPicker,
  ReferenceDataSearch,
} from "@/components/admin/ReferenceDataControls";
import type { PageWindow } from "@/lib/admin/reference-data-read-model";

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

type SelectedRegion = {
  id: string;
  name: string;
  code: string | null;
  country: { id: string; name: string; iso2: string };
};

type Props = {
  cities: City[];
  selectedRegion: SelectedRegion | null;
  query: string;
  window: PageWindow;
};

export function CityPanel({ cities, selectedRegion, query, window }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(true);

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  // Add form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [addName, setAddName] = useState("");
  const [addRegion, setAddRegion] = useState<{
    id: string;
    label: string;
  } | null>(null);

  // Merge state
  const [mergingId, setMergingId] = useState<string | null>(null);
  const [survivor, setSurvivor] = useState<{
    id: string;
    label: string;
  } | null>(null);
  const [preview, setPreview] = useState<MergePreview | null>(null);

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

  function startMerge(c: City) {
    setMergingId(c.id);
    setSurvivor(null);
    setPreview(null);
  }

  function cancelMerge() {
    setMergingId(null);
    setSurvivor(null);
    setPreview(null);
  }

  function runPreview(loserId: string) {
    if (!survivor) return;
    startTransition(async () => {
      setPreview(await previewCityMerge(loserId, survivor.id));
    });
  }

  function confirmMerge(loserId: string) {
    if (!survivor) return;
    startTransition(async () => {
      await mergeCity(loserId, survivor.id);
      cancelMerge();
      router.refresh();
    });
  }

  function handleAdd() {
    if (!addName.trim() || !addRegion) return;
    startTransition(async () => {
      await forceCreateCity(addRegion.id, addName.trim());
      setAddName("");
      setAddRegion(null);
      setShowAddForm(false);
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="city-panel-content"
        className="flex w-full items-center justify-between text-left"
      >
        <h3 className="text-sm font-semibold text-[var(--dpf-text)]">
          Cities ({window.total.toLocaleString()} matching)
        </h3>
        <span aria-hidden="true" className="text-sm text-[var(--dpf-muted)]">
          {open ? "\u25BE" : "\u25B8"}
        </span>
      </button>

      {open && (
        <div id="city-panel-content" className="mt-3 space-y-3">
          <ReferenceDataParentPicker
            label="Region"
            value={
              selectedRegion
                ? {
                    id: selectedRegion.id,
                    label: `${selectedRegion.name} · ${selectedRegion.country.name} (${selectedRegion.country.iso2})`,
                  }
                : null
            }
            placeholder="Search for a region or country..."
            paramName="cityRegion"
            resetParams={["cityQ", "cityPage"]}
            onSearch={async (searchQuery) =>
              (await searchAdminRegions(searchQuery)).map((region) => ({
                id: region.id,
                label: `${region.name}${region.code ? ` (${region.code})` : ""} · ${region.country.name}`,
              }))
            }
          />
          {selectedRegion && (
            <ReferenceDataSearch
              label={`Find cities in ${selectedRegion.name}`}
              query={query}
              queryParam="cityQ"
              pageParam="cityPage"
              placeholder="Filter by city name..."
            />
          )}

          <div className="space-y-1">
            {cities.map((c) => (
              <div key={c.id}>
                <div className="flex flex-col gap-2 rounded px-3 py-2 text-sm hover:bg-[var(--dpf-surface-2)] sm:flex-row sm:items-center sm:justify-between">
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
                    {editingId !== c.id && mergingId !== c.id && (
                      <button
                        type="button"
                        onClick={() => startEdit(c)}
                        className="text-sm text-[var(--dpf-muted)] hover:text-[var(--dpf-accent)]"
                        title="Edit city"
                      >
                        &#9998;
                      </button>
                    )}
                    {editingId !== c.id && mergingId !== c.id && (
                      <button
                        type="button"
                        onClick={() => startMerge(c)}
                        className="rounded border border-[var(--dpf-border)] px-2 py-1 text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-foreground)]"
                        title="Merge a duplicate city into another"
                      >
                        Merge
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

                {mergingId === c.id && (
                  <div className="mt-1 flex flex-wrap items-center gap-2 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 text-sm">
                    <span className="text-[var(--dpf-muted)]">
                      Merge &ldquo;{c.name}&rdquo; into:
                    </span>
                    <div className="min-w-64 flex-1">
                      <ReferenceTypeahead
                        inputId={`city-survivor-${c.id}`}
                        value={survivor}
                        placeholder="Search survivor city..."
                        onSearch={async (searchQuery) =>
                          (
                            await searchCityMergeCandidates(
                              c.region.id,
                              c.id,
                              searchQuery,
                            )
                          ).map((candidate) => ({
                            id: candidate.id,
                            label: candidate.name,
                          }))
                        }
                        onSelect={(candidate) => {
                          setSurvivor(candidate);
                          setPreview(null);
                        }}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => runPreview(c.id)}
                      disabled={isPending || !survivor}
                      className="rounded border border-[var(--dpf-border)] px-2 py-1 text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-foreground)] disabled:opacity-50"
                    >
                      Preview impact
                    </button>
                    {preview && (
                      <span
                        className={
                          preview.ok ? "text-[var(--dpf-foreground)]" : "text-red-400"
                        }
                      >
                        {preview.message}
                      </span>
                    )}
                    {preview?.ok && (
                      <button
                        type="button"
                        onClick={() => confirmMerge(c.id)}
                        disabled={isPending}
                        className="rounded bg-[var(--dpf-accent)] px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                      >
                        {isPending ? "Merging…" : "Confirm merge"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={cancelMerge}
                      className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-foreground)]"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            ))}
            {!selectedRegion && (
              <p className="px-3 py-2 text-xs text-[var(--dpf-muted)]">
                Choose a region to list its cities.
              </p>
            )}
            {selectedRegion && cities.length === 0 && (
              <p className="px-3 py-2 text-xs text-[var(--dpf-muted)]">
                No cities match this region and filter.
              </p>
            )}
          </div>
          {selectedRegion && (
            <ReferenceDataPagination
              label="City results"
              window={window}
              pageParam="cityPage"
            />
          )}

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
            <div className="flex flex-col gap-2 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 sm:flex-row sm:items-center">
              <input
                type="text"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                placeholder="City name"
                className="rounded border px-2 py-1 text-sm bg-[var(--dpf-surface-2)] border-[var(--dpf-border)] text-[var(--dpf-foreground)] placeholder:text-[var(--dpf-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--dpf-accent)]"
                autoFocus
              />
              <div className="min-w-64 flex-1">
                <ReferenceTypeahead
                  inputId="add-city-region"
                  value={addRegion}
                  placeholder="Search for the city’s region..."
                  onSearch={async (searchQuery) =>
                    (await searchAdminRegions(searchQuery)).map((region) => ({
                      id: region.id,
                      label: `${region.name}${region.code ? ` (${region.code})` : ""} · ${region.country.name}`,
                    }))
                  }
                  onSelect={setAddRegion}
                />
              </div>
              <button
                type="button"
                onClick={handleAdd}
                disabled={isPending || !addName.trim() || !addRegion}
                className="rounded bg-[var(--dpf-accent)] px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
              >
                {isPending ? "..." : "Add"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddForm(false);
                  setAddName("");
                  setAddRegion(null);
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
