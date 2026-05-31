"use client";

import { useState } from "react";

// Optional onboarding capture: market & competitive context. Saved as
// first-party narrative into the org WWWD corpus (draft for review). Independent
// of the rest of the business-context form — failure here never blocks setup.

type Fields = {
  competitiveLandscape: string;
  marketSize: string;
  differentiators: string;
  positioning: string;
};

const FIELDS: { key: keyof Fields; label: string; placeholder: string }[] = [
  { key: "competitiveLandscape", label: "Competitive landscape", placeholder: "Who do you compete with, and how is the field shaped?" },
  { key: "marketSize", label: "Market size", placeholder: "How big is your market / who could you reach? (a rough sense is fine)" },
  { key: "differentiators", label: "What sets you apart", placeholder: "Why do customers choose you over the alternatives?" },
  { key: "positioning", label: "Positioning", placeholder: "Where do you play — premium, value, niche, broad?" },
];

const EMPTY: Fields = { competitiveLandscape: "", marketSize: "", differentiators: "", positioning: "" };

export function MarketContextFields() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Fields>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasContent = Object.values(data).some((v) => v.trim().length > 0);

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/onboarding/market-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Save failed");
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 12px",
    borderRadius: 6,
    border: "1px solid var(--dpf-border)",
    fontSize: 14,
    color: "var(--dpf-text)",
    background: "var(--dpf-surface-1)",
    boxSizing: "border-box",
    resize: "none",
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "var(--dpf-accent)",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 0,
          textAlign: "left",
        }}
      >
        + Add market &amp; competitive context{" "}
        <span style={{ fontWeight: 400, color: "var(--dpf-muted)" }}>(optional)</span>
      </button>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
      <div style={{ fontWeight: 600 }}>
        Market &amp; competitive context{" "}
        <span style={{ fontWeight: 400, color: "var(--dpf-muted)" }}>(optional)</span>
      </div>
      {FIELDS.map((f) => (
        <label key={f.key} style={{ fontSize: 13 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{f.label}</div>
          <textarea
            value={data[f.key]}
            onChange={(e) => {
              setData((prev) => ({ ...prev, [f.key]: e.target.value }));
              setSaved(false);
            }}
            placeholder={f.placeholder}
            rows={2}
            style={inputStyle}
          />
        </label>
      ))}
      <div style={{ fontSize: 11, color: "var(--dpf-muted)" }}>
        We add this to your organization&apos;s knowledge as a draft for you to review — it
        sharpens what your AI coworkers know about your market.
      </div>
      {error && <p style={{ color: "var(--dpf-error)", fontSize: 12, margin: 0 }}>{error}</p>}
      {saved && <p style={{ color: "var(--dpf-success)", fontSize: 12, margin: 0 }}>Saved for review.</p>}
      <div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !hasContent}
          style={{
            padding: "6px 16px",
            borderRadius: 6,
            border: "none",
            background: "var(--dpf-accent)",
            color: "#fff",
            cursor: saving || !hasContent ? "not-allowed" : "pointer",
            fontSize: 13,
            fontWeight: 600,
            opacity: saving || !hasContent ? 0.6 : 1,
          }}
        >
          {saving ? "Saving…" : "Save market context"}
        </button>
      </div>
    </div>
  );
}
