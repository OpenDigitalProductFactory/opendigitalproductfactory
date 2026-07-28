"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateRegion,
  toggleRegionStatus,
  previewRegionMerge,
  mergeRegion,
  searchRegionMergeCandidates,
  type MergePreview,
} from "@/lib/actions/reference-data-admin";
import {
  forceCreateRegion,
  searchCountries,
} from "@/lib/actions/reference-data";
import { ReferenceTypeahead } from "@/components/ui/ReferenceTypeahead";
import {
  ReferenceDataPagination,
  ReferenceDataParentPicker,
  ReferenceDataSearch,
} from "@/components/admin/ReferenceDataControls";
import type { PageWindow } from "@/lib/admin/reference-data-read-model";

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
  selectedCountry: CountryOption | null;
  query: string;
  window: PageWindow;
};

export function RegionPanel({
  regions,
  selectedCountry,
  query,
  window,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(true);

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCode, setEditCode] = useState("");

  // Add form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [addName, setAddName] = useState("");
  const [addCode, setAddCode] = useState("");
  const [addCountry, setAddCountry] = useState<{
    id: string;
    label: string;
  } | null>(
    selectedCountry
      ? {
          id: selectedCountry.id,
          label: `${selectedCountry.name} (${selectedCountry.iso2})`,
        }
      : null,
  );

  // Merge state
  const [mergingId, setMergingId] = useState<string | null>(null);
  const [survivor, setSurvivor] = useState<{
    id: string;
    label: string;
  } | null>(null);
  const [preview, setPreview] = useState<MergePreview | null>(null);

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
    if (!addName.trim() || !addCountry) return;
    startTransition(async () => {
      await forceCreateRegion(
        addCountry.id,
        addName.trim(),
        addCode.trim() || undefined,
      );
      setAddName("");
      setAddCode("");
      setShowAddForm(false);
      router.refresh();
    });
  }

  function startMerge(r: Region) {
    setMergingId(r.id);
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
      setPreview(await previewRegionMerge(loserId, survivor.id));
    });
  }

  function confirmMerge(loserId: string) {
    if (!survivor) return;
    startTransition(async () => {
      await mergeRegion(loserId, survivor.id);
      cancelMerge();
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
        aria-expanded={open}
        aria-controls="region-panel-content"
        className="flex w-full items-center justify-between text-left"
      >
        <h3 className="text-sm font-semibold text-[var(--dpf-text)]">
          Regions ({window.total.toLocaleString()} matching)
        </h3>
        <span aria-hidden="true" className="text-sm text-[var(--dpf-muted)]">
          {open ? "\u25BE" : "\u25B8"}
        </span>
      </button>

      {open && (
        <div id="region-panel-content" className="mt-3 space-y-3">
          <ReferenceDataParentPicker
            label="Country"
            value={
              selectedCountry
                ? {
                    id: selectedCountry.id,
                    label: `${selectedCountry.name} (${selectedCountry.iso2})`,
                  }
                : null
            }
            placeholder="Search for a country..."
            paramName="regionCountry"
            resetParams={["regionQ", "regionPage"]}
            onSearch={async (searchQuery) =>
              (await searchCountries(searchQuery)).map((country) => ({
                id: country.id,
                label: `${country.name} (${country.iso2})`,
              }))
            }
          />
          {selectedCountry && (
            <ReferenceDataSearch
              label={`Find regions in ${selectedCountry.name}`}
              query={query}
              queryParam="regionQ"
              pageParam="regionPage"
              placeholder="Filter by name or code..."
            />
          )}

          <div className="space-y-1">
            {regions.map((r) => (
              <div key={r.id}>
                <div className="flex flex-col gap-2 rounded px-3 py-2 text-sm hover:bg-[var(--dpf-surface-2)] sm:flex-row sm:items-center sm:justify-between">
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
                    {editingId !== r.id && mergingId !== r.id && (
                      <button
                        type="button"
                        onClick={() => startEdit(r)}
                        className="text-sm text-[var(--dpf-muted)] hover:text-[var(--dpf-accent)]"
                        title="Edit region"
                      >
                        &#9998;
                      </button>
                    )}
                    {editingId !== r.id && mergingId !== r.id && (
                      <button
                        type="button"
                        onClick={() => startMerge(r)}
                        className="rounded border border-[var(--dpf-border)] px-2 py-1 text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-foreground)]"
                        title="Merge a duplicate region into another"
                      >
                        Merge
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

                {mergingId === r.id && (
                  <div className="mt-1 flex flex-wrap items-center gap-2 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 text-sm">
                    <span className="text-[var(--dpf-muted)]">
                      Merge &ldquo;{r.name}&rdquo; into:
                    </span>
                    <div className="min-w-64 flex-1">
                      <ReferenceTypeahead
                        inputId={`region-survivor-${r.id}`}
                        value={survivor}
                        placeholder="Search survivor region..."
                        onSearch={async (searchQuery) =>
                          (
                            await searchRegionMergeCandidates(
                              r.countryId,
                              r.id,
                              searchQuery,
                            )
                          ).map((candidate) => ({
                            id: candidate.id,
                            label: candidate.code
                              ? `${candidate.name} (${candidate.code})`
                              : candidate.name,
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
                      onClick={() => runPreview(r.id)}
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
                        onClick={() => confirmMerge(r.id)}
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
            {!selectedCountry && (
              <p className="px-3 py-2 text-xs text-[var(--dpf-muted)]">
                Choose a country to list its regions.
              </p>
            )}
            {selectedCountry && regions.length === 0 && (
              <p className="px-3 py-2 text-xs text-[var(--dpf-muted)]">
                No regions match this country and filter.
              </p>
            )}
          </div>
          {selectedCountry && (
            <ReferenceDataPagination
              label="Region results"
              window={window}
              pageParam="regionPage"
            />
          )}

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
            <div className="flex flex-col gap-2 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 sm:flex-row sm:items-center">
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
              <div className="min-w-64 flex-1">
                <ReferenceTypeahead
                  inputId="add-region-country"
                  value={addCountry}
                  placeholder="Search for the region’s country..."
                  onSearch={async (searchQuery) =>
                    (await searchCountries(searchQuery)).map((country) => ({
                      id: country.id,
                      label: `${country.name} (${country.iso2})`,
                    }))
                  }
                  onSelect={setAddCountry}
                />
              </div>
              <button
                type="button"
                onClick={handleAdd}
                disabled={isPending || !addName.trim() || !addCountry}
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
                  setAddCountry(null);
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
