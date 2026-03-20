"use client";
import { useState } from "react";

type Entry = {
  id: string;
  ref: string;
  name: string | null;
  email: string;
  type: string;
  detail: string;
  createdAt: string;
};

const TYPE_LABELS: Record<string, string> = {
  inquiry: "Inquiry",
  booking: "Booking",
  order: "Order",
  donation: "Donation",
};

export function StorefrontInbox({ entries }: { entries: Entry[] }) {
  const [filter, setFilter] = useState<string>("all");
  const filtered = filter === "all" ? entries : entries.filter((e) => e.type === filter);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {["all", "inquiry", "booking", "order", "donation"].map((t) => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            style={{
              padding: "4px 10px",
              borderRadius: 4,
              border: "1px solid var(--dpf-border)",
              background: filter === t ? "var(--dpf-accent, #4f46e5)" : "none",
              color: filter === t ? "#fff" : "inherit",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            {t === "all" ? "All" : TYPE_LABELS[t]}
          </button>
        ))}
      </div>
      {filtered.length === 0 && <p style={{ color: "var(--dpf-muted)", fontSize: 13 }}>No entries yet.</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filtered.map((e) => (
          <div key={e.id} style={{ padding: "12px 16px", border: "1px solid var(--dpf-border)", borderRadius: 8 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline", marginBottom: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 700, padding: "1px 6px", borderRadius: 3, background: "#f3f4f6" }}>
                {TYPE_LABELS[e.type] ?? e.type}
              </span>
              <span style={{ fontSize: 12, fontFamily: "monospace" }}>{e.ref}</span>
              <span style={{ fontSize: 11, color: "var(--dpf-muted)", marginLeft: "auto" }}>
                {new Date(e.createdAt).toLocaleDateString("en-GB")}
              </span>
            </div>
            <div style={{ fontSize: 13 }}>{e.name ?? "Anonymous"} · {e.email}</div>
            {e.detail && <div style={{ fontSize: 12, color: "var(--dpf-muted)", marginTop: 2 }}>{e.detail}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
