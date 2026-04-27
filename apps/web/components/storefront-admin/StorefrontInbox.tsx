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
  backlogItemId?: string | null;
};

const TYPE_LABELS: Record<string, string> = {
  inquiry: "Inquiry",
  booking: "Booking",
  order: "Order",
  donation: "Donation",
};

const STATUS_STYLES: Record<string, { background: string; color: string }> = {
  pending: { background: "rgba(245,158,11,0.15)", color: "var(--dpf-warning, #f59e0b)" },
  confirmed: { background: "color-mix(in srgb, var(--dpf-success) 15%, transparent)", color: "var(--dpf-success, #22c55e)" },
  completed: { background: "rgba(79,70,229,0.15)", color: "var(--dpf-accent, #4f46e5)" },
  cancelled: { background: "color-mix(in srgb, var(--dpf-error) 15%, transparent)", color: "var(--dpf-error, #ef4444)" },
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
  defaultDigitalProduct,
}: {
  entries: Entry[];
  providers?: { id: string; name: string }[];
  defaultDigitalProduct?: { id: string; name: string } | null;
}) {
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [providerFilter, setProviderFilter] = useState<string>("all");
  const [productBacklogState, setProductBacklogState] = useState<Record<string, string>>({});
  const [pendingInquiryId, setPendingInquiryId] = useState<string | null>(null);

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

  async function sendInquiryToProductBacklog(id: string) {
    if (!defaultDigitalProduct) return;
    setPendingInquiryId(id);
    try {
      const res = await fetch(`/api/storefront/admin/inquiries/${id}/product-backlog`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ digitalProductId: defaultDigitalProduct.id }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error ?? "Failed to create backlog item");
      }
      setProductBacklogState((current) => ({
        ...current,
        [id]: body.backlogItem?.itemId ?? "Created",
      }));
    } catch (error) {
      setProductBacklogState((current) => ({
        ...current,
        [id]: error instanceof Error ? error.message : "Failed to create backlog item",
      }));
    } finally {
      setPendingInquiryId(null);
    }
  }

  return (
    <div>
      {defaultDigitalProduct ? (
        <div
          style={{
            marginBottom: 16,
            padding: "12px 14px",
            borderRadius: 8,
            border: "1px solid var(--dpf-border)",
            background: "var(--dpf-surface-2)",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--dpf-text)" }}>
            Customer-zero inquiry intake is wired to product backlog triage
          </div>
          <div style={{ marginTop: 4, fontSize: 12, color: "var(--dpf-muted)" }}>
            Use <strong>Send to product backlog</strong> to capture DPF sales or product signals as triaging work for{" "}
            {defaultDigitalProduct.name}.
          </div>
        </div>
      ) : (
        <div
          style={{
            marginBottom: 16,
            padding: "12px 14px",
            borderRadius: 8,
            border: "1px solid var(--dpf-border)",
            background: "var(--dpf-surface-2)",
            color: "var(--dpf-muted)",
            fontSize: 12,
          }}
        >
          No digital product is configured yet, so storefront inquiries cannot be routed into the product backlog.
        </div>
      )}

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
              {e.type === "inquiry" && (
                <span
                  style={{
                    fontSize: 11,
                    padding: "1px 7px",
                    borderRadius: 10,
                    background: "color-mix(in srgb, var(--dpf-accent) 14%, transparent)",
                    color: "var(--dpf-accent)",
                  }}
                >
                  Customer-zero signal
                </span>
              )}
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
            {e.type === "inquiry" && (
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
                <button
                  onClick={() => sendInquiryToProductBacklog(e.id)}
                  disabled={!defaultDigitalProduct || pendingInquiryId === e.id}
                  style={{
                    padding: "3px 10px",
                    borderRadius: 4,
                    border: "1px solid var(--dpf-accent)",
                    background: "none",
                    color: "var(--dpf-accent)",
                    cursor: !defaultDigitalProduct || pendingInquiryId === e.id ? "not-allowed" : "pointer",
                    fontSize: 12,
                    opacity: !defaultDigitalProduct || pendingInquiryId === e.id ? 0.6 : 1,
                  }}
                >
                  {pendingInquiryId === e.id ? "Sending..." : "Send to product backlog"}
                </button>
                {e.backlogItemId && (
                  <span style={{ fontSize: 12, color: "var(--dpf-success, #22c55e)" }}>
                    Backlog item {e.backlogItemId}
                  </span>
                )}
                {!e.backlogItemId && productBacklogState[e.id] && (
                  <span
                    style={{
                      fontSize: 12,
                      color: productBacklogState[e.id].startsWith("BI-")
                        ? "var(--dpf-success, #22c55e)"
                        : "var(--dpf-error, #ef4444)",
                    }}
                  >
                    {productBacklogState[e.id].startsWith("BI-")
                      ? `Backlog item ${productBacklogState[e.id]}`
                      : productBacklogState[e.id]}
                  </span>
                )}
              </div>
            )}
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
