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
  providerName: string | null;
  status: string;
};

const TYPE_LABELS: Record<string, string> = {
  inquiry: "Inquiry",
  booking: "Booking",
  order: "Order",
  donation: "Donation",
};

const STATUS_STYLES: Record<string, { background: string; color: string }> = {
  pending: { background: "rgba(245,158,11,0.15)", color: "var(--dpf-warning, #f59e0b)" },
  confirmed: { background: "rgba(34,197,94,0.15)", color: "var(--dpf-success, #22c55e)" },
  completed: { background: "rgba(79,70,229,0.15)", color: "var(--dpf-accent, #4f46e5)" },
  cancelled: { background: "rgba(239,68,68,0.15)", color: "var(--dpf-error, #ef4444)" },
  "needs-reschedule": { background: "rgba(249,115,22,0.15)", color: "#f97316" },
};

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? { background: "var(--dpf-surface-2)", color: "var(--dpf-muted)" };
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: "1px 7px", borderRadius: 10, ...style }}>
      {status.replace(/-/g, " ")}
    </span>
  );
}

export function StorefrontInbox({
  entries,
  providers = [],
}: {
  entries: Entry[];
  providers?: { id: string; name: string }[];
}) {
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [providerFilter, setProviderFilter] = useState<string>("all");

  const filtered = entries.filter((e) => {
    if (typeFilter !== "all" && e.type !== typeFilter) return false;
    if (typeFilter === "booking" && providerFilter !== "all" && e.providerName !== providerFilter) return false;
    return true;
  });

  async function cancelBooking(id: string) {
    const reason = window.prompt("Cancellation reason:");
    if (reason === null) return; // user dismissed
    await fetch(`/api/storefront/bookings/${id}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    window.location.reload();
  }

  async function confirmBooking(id: string) {
    await fetch(`/api/storefront/bookings/${id}/confirm`, {
      method: "POST",
    });
    window.location.reload();
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        {["all", "inquiry", "booking", "order", "donation"].map((t) => (
          <button
            key={t}
            onClick={() => { setTypeFilter(t); setProviderFilter("all"); }}
            style={{
              padding: "4px 10px",
              borderRadius: 4,
              border: "1px solid var(--dpf-border)",
              background: typeFilter === t ? "var(--dpf-accent, #4f46e5)" : "none",
              color: typeFilter === t ? "#fff" : "inherit",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            {t === "all" ? "All" : TYPE_LABELS[t]}
          </button>
        ))}
        {typeFilter === "booking" && providers.length > 0 && (
          <select
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            style={{
              padding: "4px 10px",
              borderRadius: 4,
              border: "1px solid var(--dpf-border)",
              background: "var(--dpf-surface-2)",
              color: "inherit",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            <option value="all">All providers</option>
            {providers.map((p) => (
              <option key={p.id} value={p.name}>{p.name}</option>
            ))}
          </select>
        )}
      </div>

      {filtered.length === 0 && <p style={{ color: "var(--dpf-muted)", fontSize: 13 }}>No entries yet.</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filtered.map((e) => (
          <div key={e.id} style={{ padding: "12px 16px", border: "1px solid var(--dpf-border)", borderRadius: 8 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline", marginBottom: 4, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, fontWeight: 700, padding: "1px 6px", borderRadius: 3, background: "var(--dpf-surface-2)" }}>
                {TYPE_LABELS[e.type] ?? e.type}
              </span>
              <span style={{ fontSize: 12, fontFamily: "monospace" }}>{e.ref}</span>
              {e.type === "booking" && e.status && <StatusBadge status={e.status} />}
              {e.type === "booking" && e.providerName && (
                <span style={{ fontSize: 11, padding: "1px 7px", borderRadius: 10, background: "rgba(79,70,229,0.12)", color: "var(--dpf-accent, #4f46e5)" }}>
                  {e.providerName}
                </span>
              )}
              <span style={{ fontSize: 11, color: "var(--dpf-muted)", marginLeft: "auto" }}>
                {new Date(e.createdAt).toLocaleDateString("en-GB")}
              </span>
            </div>
            <div style={{ fontSize: 13 }}>{e.name ?? "Anonymous"} · {e.email}</div>
            {e.detail && <div style={{ fontSize: 12, color: "var(--dpf-muted)", marginTop: 2 }}>{e.detail}</div>}
            {e.type === "booking" && (
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                {e.status === "pending" && (
                  <button
                    onClick={() => confirmBooking(e.id)}
                    style={{ padding: "3px 10px", borderRadius: 4, border: "1px solid var(--dpf-success, #22c55e)", background: "none", color: "var(--dpf-success, #22c55e)", cursor: "pointer", fontSize: 12 }}
                  >
                    Confirm
                  </button>
                )}
                {e.status !== "cancelled" && e.status !== "completed" && (
                  <button
                    onClick={() => cancelBooking(e.id)}
                    style={{ padding: "3px 10px", borderRadius: 4, border: "1px solid var(--dpf-error, #ef4444)", background: "none", color: "var(--dpf-error, #ef4444)", cursor: "pointer", fontSize: 12 }}
                  >
                    Cancel
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
