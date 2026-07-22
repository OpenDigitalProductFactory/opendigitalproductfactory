"use client";
import { useState } from "react";
import { useRowActions, assertOk, RowStatus } from "./use-row-action";

type Section = { id: string; type: string; title: string | null; sortOrder: number; isVisible: boolean };

/** Turns an internal section-type slug (e.g. "opening_hours") into owner-readable text. */
function humanizeSectionType(type: string): string {
  return type
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export function SectionsManager({ storefrontId, sections: initial }: { storefrontId: string; sections: Section[] }) {
  const [sections, setSections] = useState(initial);
  const { statuses, runRowAction } = useRowActions();

  function toggleVisibility(id: string, isVisible: boolean, name: string) {
    void runRowAction(id, {
      savingMessage: "Saving…",
      successMessage: isVisible ? "Shown on your public page" : "Hidden from your public page",
      run: async () => {
        const res = await fetch(`/api/storefront/admin/sections/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isVisible }),
        });
        await assertOk(res, `Couldn't update ${name}. Try again.`);
        // Apply only after the server confirms — never leave the UI showing an unsaved change.
        setSections((prev) => prev.map((s) => (s.id === id ? { ...s, isVisible } : s)));
      },
    });
  }

  function moveSection(id: string, direction: "up" | "down", name: string) {
    const idx = sections.findIndex((s) => s.id === id);
    if (direction === "up" && idx === 0) return;
    if (direction === "down" && idx === sections.length - 1) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    const updated = [...sections];
    const tmp = updated[idx]!;
    updated[idx] = updated[swapIdx]!;
    updated[swapIdx] = tmp;
    const reordered = updated.map((s, i) => ({ ...s, sortOrder: i }));

    void runRowAction(id, {
      savingMessage: "Saving order…",
      successMessage: direction === "up" ? "Moved up" : "Moved down",
      run: async () => {
        const res = await fetch(`/api/storefront/admin/sections/reorder`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storefrontId, order: reordered.map((s) => s.id) }),
        });
        await assertOk(res, `Couldn't move ${name}. Try again.`);
        setSections(reordered);
      },
    });
  }

  return (
    <div>
      <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Sections</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {sections.map((s, idx) => {
          const name = s.title ?? humanizeSectionType(s.type);
          const status = statuses[s.id];
          return (
          <div key={s.id} className="rounded-md border border-[var(--dpf-border)] px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <span style={{ fontWeight: 600, fontSize: 13 }}>{name}</span>
              </div>
              {/* Reorder / visibility — row-specific accessible labels and 44px hit
                  areas so the arrows and Hide/Show are safe to tap and screen-reader
                  legible ("Move Hero up", "Hide Hero section") rather than anonymous. */}
              <button
                onClick={() => moveSection(s.id, "up", name)}
                disabled={idx === 0 || status?.kind === "saving"}
                aria-label={`Move ${name} up`}
                className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-[var(--dpf-text)] text-sm disabled:opacity-40"
              >↑</button>
              <button
                onClick={() => moveSection(s.id, "down", name)}
                disabled={idx === sections.length - 1 || status?.kind === "saving"}
                aria-label={`Move ${name} down`}
                className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-[var(--dpf-text)] text-sm disabled:opacity-40"
              >↓</button>
              <button
                onClick={() => toggleVisibility(s.id, !s.isVisible, name)}
                disabled={status?.kind === "saving"}
                aria-label={s.isVisible ? `Hide ${name} section from your public page` : `Show ${name} section on your public page`}
                className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-[var(--dpf-text)] px-3 text-xs disabled:opacity-60"
              >
                {s.isVisible ? "Hide" : "Show"}
              </button>
            </div>
            <RowStatus status={status} />
          </div>
          );
        })}
      </div>
    </div>
  );
}
