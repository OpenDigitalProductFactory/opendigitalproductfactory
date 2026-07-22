"use client";
import { useState } from "react";

type Section = { id: string; type: string; title: string | null; sortOrder: number; isVisible: boolean };

export function SectionsManager({ storefrontId, sections: initial }: { storefrontId: string; sections: Section[] }) {
  const [sections, setSections] = useState(initial);

  async function toggleVisibility(id: string, isVisible: boolean) {
    await fetch(`/api/storefront/admin/sections/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isVisible }),
    });
    setSections((prev) => prev.map((s) => s.id === id ? { ...s, isVisible } : s));
  }

  async function moveSection(id: string, direction: "up" | "down") {
    const idx = sections.findIndex((s) => s.id === id);
    if (direction === "up" && idx === 0) return;
    if (direction === "down" && idx === sections.length - 1) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    const updated = [...sections];
    const tmp = updated[idx]!;
    updated[idx] = updated[swapIdx]!;
    updated[swapIdx] = tmp;
    const reordered = updated.map((s, i) => ({ ...s, sortOrder: i }));
    setSections(reordered);
    await fetch(`/api/storefront/admin/sections/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storefrontId, order: reordered.map((s) => s.id) }),
    });
  }

  return (
    <div>
      <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Sections</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {sections.map((s, idx) => {
          const name = s.title ?? s.type;
          return (
          <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--dpf-border)] px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <span style={{ fontWeight: 600, fontSize: 13 }}>{name}</span>
              <span className="text-[var(--dpf-muted)]" style={{ fontSize: 11, marginLeft: 6 }}>{s.type}</span>
            </div>
            {/* Reorder / visibility — row-specific accessible labels and 44px hit
                areas so the arrows and Hide/Show are safe to tap and screen-reader
                legible ("Move Hero up", "Hide Hero section") rather than anonymous. */}
            <button
              onClick={() => moveSection(s.id, "up")}
              disabled={idx === 0}
              aria-label={`Move ${name} up`}
              className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-[var(--dpf-text)] text-sm disabled:opacity-40"
            >↑</button>
            <button
              onClick={() => moveSection(s.id, "down")}
              disabled={idx === sections.length - 1}
              aria-label={`Move ${name} down`}
              className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-[var(--dpf-text)] text-sm disabled:opacity-40"
            >↓</button>
            <button
              onClick={() => toggleVisibility(s.id, !s.isVisible)}
              aria-label={s.isVisible ? `Hide ${name} section from your public page` : `Show ${name} section on your public page`}
              className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-[var(--dpf-text)] px-3 text-xs"
            >
              {s.isVisible ? "Hide" : "Show"}
            </button>
          </div>
          );
        })}
      </div>
    </div>
  );
}
