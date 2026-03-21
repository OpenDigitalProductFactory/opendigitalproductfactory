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
        {sections.map((s, idx) => (
          <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", border: "1px solid var(--dpf-border)", borderRadius: 6 }}>
            <div style={{ flex: 1 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{s.title ?? s.type}</span>
              <span style={{ fontSize: 11, color: "var(--dpf-muted)", marginLeft: 6 }}>{s.type}</span>
            </div>
            <button onClick={() => moveSection(s.id, "up")} disabled={idx === 0} style={{ fontSize: 12, padding: "2px 8px", borderRadius: 4, border: "1px solid var(--dpf-border)", background: "var(--dpf-surface-1)", color: "var(--dpf-text)", cursor: "pointer" }}>↑</button>
            <button onClick={() => moveSection(s.id, "down")} disabled={idx === sections.length - 1} style={{ fontSize: 12, padding: "2px 8px", borderRadius: 4, border: "1px solid var(--dpf-border)", background: "var(--dpf-surface-1)", color: "var(--dpf-text)", cursor: "pointer" }}>↓</button>
            <button onClick={() => toggleVisibility(s.id, !s.isVisible)}
              style={{ fontSize: 12, padding: "2px 8px", borderRadius: 4, border: "1px solid var(--dpf-border)", background: "var(--dpf-surface-1)", color: "var(--dpf-text)", cursor: "pointer" }}>
              {s.isVisible ? "Hide" : "Show"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
