"use client";

// Admin manager for adoptable animals (pet-rescue / animal-shelter). Creates and
// edits AdoptableAnimal records and, per animal, embeds the reusable MediaUploader
// so each gets a photo gallery. Photos drive the public `animals-available`
// section through the media substrate.
//
// Every descriptive field used to be write-once here: the list row rendered only
// name and status, so an intake note carrying a finder's name, telephone number
// and home address could be corrected only by deleting the animal and its
// photographs (BI-56BB6038). The API already accepted the full patch; the surface
// did not offer it. Details now sit behind a per-animal disclosure, so a ward of
// forty stays scannable and a correction is one click away (DI-88E0F9374F4D).
//
// Delete asks first, at a target size a kennel technician can hit one-handed on
// the tablet the work is really done on.

import Link from "next/link";
import { useRef, useState } from "react";
import { MediaUploader } from "./MediaUploader";

interface MediaItem {
  attachmentId: string;
  assetId: string;
  url: string;
  altText: string | null;
  caption: string | null;
}

interface AdminAnimal {
  id: string;
  name: string;
  species: string | null;
  breed: string | null;
  age: string | null;
  sex: string | null;
  size: string | null;
  description: string | null;
  status: string;
  media: MediaItem[];
}

type SaveState = "saving" | "saved" | "error";

const STATUSES = ["available", "pending", "hold", "adopted"];
const SPECIES = ["dog", "cat", "rabbit", "bird", "other"];

const inputStyle: React.CSSProperties = {
  fontSize: 13,
  padding: "6px 8px",
  borderRadius: 6,
  width: "100%",
};

const inputClass = "border border-[var(--dpf-border)] bg-[var(--dpf-bg)] text-[var(--dpf-text)]";

/** Destructive and confirming controls are hit one-handed on a 768px tablet, so
 *  they carry the 44px target the rest of the portal uses. */
const touchTargetStyle: React.CSSProperties = {
  minHeight: 44,
  fontSize: 13,
  padding: "8px 14px",
  borderRadius: 6,
  cursor: "pointer",
};

const emptyDraft = {
  name: "",
  species: "dog",
  breed: "",
  age: "",
  sex: "",
  size: "",
  status: "available",
  description: "",
};

export function AnimalsManager({
  animals: initial,
  hasAnimalsSection,
}: {
  animals: AdminAnimal[];
  hasAnimalsSection: boolean;
}) {
  const [animals, setAnimals] = useState<AdminAnimal[]>(initial);
  const [draft, setDraft] = useState({ ...emptyDraft });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({});
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  // Last value the server confirmed, so a rejected save can be rolled back
  // rather than leaving the screen showing an edit that was never stored.
  const confirmed = useRef<Record<string, AdminAnimal>>(
    Object.fromEntries(initial.map((a) => [a.id, a])),
  );

  async function createAnimal() {
    if (!draft.name.trim()) {
      setError("Name is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/storefront/admin/animals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Could not add animal.");
        return;
      }
      const created = (await res.json()) as AdminAnimal;
      const record = { ...created, media: [] };
      confirmed.current[record.id] = record;
      setAnimals((prev) => [...prev, record]);
      setDraft({ ...emptyDraft });
    } finally {
      setBusy(false);
    }
  }

  /** Type into a field without writing to the server on every keystroke. */
  function editAnimal(id: string, patch: Partial<AdminAnimal>) {
    setAnimals((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }

  /** Store the edit. A rejected save rolls the field back to the stored value and
   *  says so, rather than leaving a correction that only looks applied. */
  async function saveAnimal(id: string, patch: Partial<AdminAnimal>) {
    const previous = confirmed.current[id];
    const unchanged =
      previous != null &&
      Object.entries(patch).every(([key, value]) => previous[key as keyof AdminAnimal] === value);
    if (unchanged) return;

    editAnimal(id, patch);
    setSaveState((prev) => ({ ...prev, [id]: "saving" }));
    const res = await fetch(`/api/storefront/admin/animals/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => null);

    if (!res?.ok) {
      if (previous) {
        setAnimals((prev) =>
          prev.map((a) => (a.id === id ? { ...previous, media: a.media } : a)),
        );
      }
      setSaveState((prev) => ({ ...prev, [id]: "error" }));
      return;
    }
    confirmed.current[id] = { ...(previous ?? ({ id } as AdminAnimal)), ...patch };
    setSaveState((prev) => ({ ...prev, [id]: "saved" }));
  }

  async function deleteAnimal(id: string) {
    setPendingDelete(null);
    const res = await fetch(`/api/storefront/admin/animals/${id}`, {
      method: "DELETE",
    }).catch(() => null);
    if (!res?.ok) {
      setSaveState((prev) => ({ ...prev, [id]: "error" }));
      return;
    }
    delete confirmed.current[id];
    setAnimals((prev) => prev.filter((a) => a.id !== id));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 880 }}>
      <div>
        <h1 className="text-[var(--dpf-text)]" style={{ fontSize: 20, fontWeight: 600 }}>
          Adoptable animals
        </h1>
        <p className="text-[var(--dpf-muted)]" style={{ fontSize: 13 }}>
          These show on your public storefront with their photos.{" "}
          <Link
            href="/storefront/animals/waiting"
            className="text-[var(--dpf-accent)] underline-offset-2 hover:underline"
          >
            Waiting list
          </Link>
        </p>
        {!hasAnimalsSection && (
          <p className="text-[var(--dpf-error)]" style={{ fontSize: 12 }}>
            Add an “animals-available” section to show them.
          </p>
        )}
      </div>

      {/* Create form */}
      <div
        className="border border-[var(--dpf-border)]"
        style={{
          borderRadius: 8,
          padding: 16,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 10,
          alignItems: "end",
        }}
      >
        <label style={{ gridColumn: "1 / -1" }}>
          <span className="text-[var(--dpf-muted)]" style={{ fontSize: 12 }}>Name *</span>
          <input className={inputClass} style={inputStyle} value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </label>
        <label>
          <span className="text-[var(--dpf-muted)]" style={{ fontSize: 12 }}>Species</span>
          <select className={inputClass} style={inputStyle} value={draft.species}
            onChange={(e) => setDraft({ ...draft, species: e.target.value })}>
            {SPECIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>
          <span className="text-[var(--dpf-muted)]" style={{ fontSize: 12 }}>Breed</span>
          <input className={inputClass} style={inputStyle} value={draft.breed}
            onChange={(e) => setDraft({ ...draft, breed: e.target.value })} />
        </label>
        <label>
          <span className="text-[var(--dpf-muted)]" style={{ fontSize: 12 }}>Age</span>
          <input className={inputClass} style={inputStyle} value={draft.age} placeholder="e.g. young"
            onChange={(e) => setDraft({ ...draft, age: e.target.value })} />
        </label>
        <label>
          <span className="text-[var(--dpf-muted)]" style={{ fontSize: 12 }}>Sex</span>
          <input className={inputClass} style={inputStyle} value={draft.sex}
            onChange={(e) => setDraft({ ...draft, sex: e.target.value })} />
        </label>
        <label>
          <span className="text-[var(--dpf-muted)]" style={{ fontSize: 12 }}>Size</span>
          <input className={inputClass} style={inputStyle} value={draft.size}
            onChange={(e) => setDraft({ ...draft, size: e.target.value })} />
        </label>
        <label style={{ gridColumn: "1 / -1" }}>
          <span className="text-[var(--dpf-muted)]" style={{ fontSize: 12 }}>Description</span>
          <textarea className={inputClass} style={{ ...inputStyle, minHeight: 56 }} value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
        </label>
        <button type="button" onClick={() => void createAnimal()} disabled={busy}
          className="bg-[var(--dpf-accent)] text-white"
          style={{
            fontSize: 13, padding: "8px 14px", borderRadius: 6,
            border: "none",
            cursor: busy ? "default" : "pointer",
          }}>
          {busy ? "Adding…" : "Add animal"}
        </button>
        {error && <div className="text-[var(--dpf-error)]" style={{ fontSize: 12 }}>{error}</div>}
      </div>

      {/* List */}
      {animals.length === 0 ? (
        <div className="text-[var(--dpf-muted)]" style={{ fontSize: 13 }}>No animals yet.</div>
      ) : (
        animals.map((animal) => (
          <div key={animal.id}
            className="border border-[var(--dpf-border)]"
            style={{ borderRadius: 8, padding: 16,
              display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <input className={inputClass} style={{ ...inputStyle, width: 200, fontWeight: 600 }} value={animal.name}
                onChange={(e) => editAnimal(animal.id, { name: e.target.value })}
                onBlur={(e) => void saveAnimal(animal.id, { name: e.target.value })} />
              <select className={inputClass} style={{ ...inputStyle, width: 140 }} value={animal.status}
                onChange={(e) => void saveAnimal(animal.id, { status: e.target.value })}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <span className="text-[var(--dpf-muted)]" style={{ fontSize: 12 }}>
                {[animal.species, animal.breed, animal.age].filter(Boolean).join(" · ")}
              </span>
              {saveState[animal.id] === "saving" && (
                <span className="text-[var(--dpf-muted)]" style={{ fontSize: 12 }}>Saving…</span>
              )}
              {saveState[animal.id] === "saved" && (
                <span className="text-[var(--dpf-muted)]" style={{ fontSize: 12 }}>Saved</span>
              )}
              {saveState[animal.id] === "error" && (
                <span role="alert" className="text-[var(--dpf-error)]" style={{ fontSize: 12 }}>Not saved</span>
              )}

              {pendingDelete === animal.id ? (
                <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
                  <span className="text-[var(--dpf-error)]" style={{ fontSize: 12 }}>
                    Also removes the photos.
                  </span>
                  <button type="button" onClick={() => void deleteAnimal(animal.id)}
                    className="border border-[var(--dpf-error)] bg-transparent text-[var(--dpf-error)]"
                    style={touchTargetStyle}>
                    Delete
                  </button>
                  <button type="button" onClick={() => setPendingDelete(null)}
                    className="border border-[var(--dpf-border)] bg-transparent text-[var(--dpf-text)]"
                    style={touchTargetStyle}>
                    Keep
                  </button>
                </span>
              ) : (
                <button type="button" onClick={() => setPendingDelete(animal.id)}
                  className="border border-[var(--dpf-border)] bg-transparent text-[var(--dpf-error)]"
                  style={{ ...touchTargetStyle, marginLeft: "auto" }}>
                  Delete
                </button>
              )}
            </div>

            {/* Correcting what was typed at intake, without deleting the animal. */}
            <details>
              <summary className="text-[var(--dpf-muted)]"
                style={{ fontSize: 12, cursor: "pointer", minHeight: 28 }}>
                Details
              </summary>
              <div style={{
                marginTop: 10,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                gap: 10,
              }}>
                <label>
                  <span className="text-[var(--dpf-muted)]" style={{ fontSize: 12 }}>Species</span>
                  <select className={inputClass} style={inputStyle} value={animal.species ?? ""}
                    onChange={(e) => void saveAnimal(animal.id, { species: e.target.value })}>
                    {SPECIES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                <label>
                  <span className="text-[var(--dpf-muted)]" style={{ fontSize: 12 }}>Breed</span>
                  <input className={inputClass} style={inputStyle} value={animal.breed ?? ""}
                    onChange={(e) => editAnimal(animal.id, { breed: e.target.value })}
                    onBlur={(e) => void saveAnimal(animal.id, { breed: e.target.value })} />
                </label>
                <label>
                  <span className="text-[var(--dpf-muted)]" style={{ fontSize: 12 }}>Age</span>
                  <input className={inputClass} style={inputStyle} value={animal.age ?? ""}
                    onChange={(e) => editAnimal(animal.id, { age: e.target.value })}
                    onBlur={(e) => void saveAnimal(animal.id, { age: e.target.value })} />
                </label>
                <label>
                  <span className="text-[var(--dpf-muted)]" style={{ fontSize: 12 }}>Sex</span>
                  <input className={inputClass} style={inputStyle} value={animal.sex ?? ""}
                    onChange={(e) => editAnimal(animal.id, { sex: e.target.value })}
                    onBlur={(e) => void saveAnimal(animal.id, { sex: e.target.value })} />
                </label>
                <label>
                  <span className="text-[var(--dpf-muted)]" style={{ fontSize: 12 }}>Size</span>
                  <input className={inputClass} style={inputStyle} value={animal.size ?? ""}
                    onChange={(e) => editAnimal(animal.id, { size: e.target.value })}
                    onBlur={(e) => void saveAnimal(animal.id, { size: e.target.value })} />
                </label>
                <label style={{ gridColumn: "1 / -1" }}>
                  <span className="text-[var(--dpf-muted)]" style={{ fontSize: 12 }}>Description</span>
                  <textarea className={inputClass} style={{ ...inputStyle, minHeight: 56 }}
                    value={animal.description ?? ""}
                    onChange={(e) => editAnimal(animal.id, { description: e.target.value })}
                    onBlur={(e) => void saveAnimal(animal.id, { description: e.target.value })} />
                </label>
              </div>
            </details>

            <MediaUploader
              ownerType="AdoptableAnimal"
              ownerId={animal.id}
              role="gallery"
              label="Photos"
              hint="First photo leads the listing."
            />
          </div>
        ))
      )}
    </div>
  );
}
