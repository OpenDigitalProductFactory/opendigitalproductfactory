"use client";

// Admin manager for adoptable animals (pet-rescue / animal-shelter). Creates and
// edits AdoptableAnimal records and, per animal, embeds the reusable MediaUploader
// so each gets a photo gallery. Photos drive the public `animals-available`
// section through the media substrate.

import { useState } from "react";
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

const STATUSES = ["available", "pending", "hold", "adopted"];
const SPECIES = ["dog", "cat", "rabbit", "bird", "other"];

const inputStyle: React.CSSProperties = {
  fontSize: 13,
  padding: "6px 8px",
  borderRadius: 6,
  width: "100%",
};

const inputClass = "border border-[var(--dpf-border)] bg-[var(--dpf-bg)] text-[var(--dpf-text)]";

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
      setAnimals((prev) => [...prev, { ...created, media: [] }]);
      setDraft({ ...emptyDraft });
    } finally {
      setBusy(false);
    }
  }

  async function updateAnimal(id: string, patch: Partial<AdminAnimal>) {
    setAnimals((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
    await fetch(`/api/storefront/admin/animals/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  async function deleteAnimal(id: string) {
    await fetch(`/api/storefront/admin/animals/${id}`, { method: "DELETE" });
    setAnimals((prev) => prev.filter((a) => a.id !== id));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 880 }}>
      <div>
        <h1 className="text-[var(--dpf-text)]" style={{ fontSize: 20, fontWeight: 600 }}>
          Adoptable animals
        </h1>
        <p className="text-[var(--dpf-muted)]" style={{ fontSize: 13 }}>
          These appear in the “Animals available for adoption” section of your public storefront,
          each with their photos.
        </p>
        {!hasAnimalsSection && (
          <p className="text-[var(--dpf-error)]" style={{ fontSize: 12 }}>
            Your storefront has no “animals-available” section yet — add one in Sections to show
            these publicly.
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
                onChange={(e) => updateAnimal(animal.id, { name: e.target.value })} />
              <select className={inputClass} style={{ ...inputStyle, width: 140 }} value={animal.status}
                onChange={(e) => updateAnimal(animal.id, { status: e.target.value })}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <span className="text-[var(--dpf-muted)]" style={{ fontSize: 12 }}>
                {[animal.species, animal.breed, animal.age].filter(Boolean).join(" · ")}
              </span>
              <button type="button" onClick={() => void deleteAnimal(animal.id)}
                className="border border-[var(--dpf-border)] bg-transparent text-[var(--dpf-error)]"
                style={{ marginLeft: "auto", fontSize: 12, padding: "4px 10px",
                  borderRadius: 6, cursor: "pointer" }}>
                Delete
              </button>
            </div>
            <MediaUploader
              ownerType="AdoptableAnimal"
              ownerId={animal.id}
              role="gallery"
              label="Photos"
              hint="First photo is the lead image shown on the storefront"
            />
          </div>
        ))
      )}
    </div>
  );
}
