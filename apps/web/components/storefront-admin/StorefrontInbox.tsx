"use client";
import { useState } from "react";
import { promptDialog } from "@/components/ui/Dialog";
import { reservationActionLabel } from "@/lib/storefront/booking-summary";

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
  // Reservation handoff fields (bookings only).
  itemName?: string | null;
  covers?: number | null;
  dietaryNotes?: string | null;
  whenLabel?: string;
  timeLabel?: string;
  nextAction?: string;
};

const TYPE_LABELS: Record<string, string> = {
  inquiry: "Inquiry",
  booking: "Booking",
  order: "Order",
  donation: "Donation",
};

const STATUS_STYLES: Record<string, { background: string; color: string }> = {
  pending: { background: "rgba(245,158,11,0.15)", color: "var(--dpf-warning)" },
  confirmed: { background: "color-mix(in srgb, var(--dpf-success) 15%, transparent)", color: "var(--dpf-success)" },
  completed: { background: "rgba(79,70,229,0.15)", color: "var(--dpf-accent)" },
  cancelled: { background: "color-mix(in srgb, var(--dpf-error) 15%, transparent)", color: "var(--dpf-error)" },
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
    const reason = await promptDialog({
      title: "Cancel booking",
      message: "Cancellation reason:",
      confirmLabel: "Cancel booking",
      cancelLabel: "Keep booking",
    });
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
          className="border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)]"
          style={{
            marginBottom: 16,
            padding: "12px 14px",
            borderRadius: 8,
          }}
        >
          <div className="text-[var(--dpf-text)]" style={{ fontSize: 12, fontWeight: 700 }}>
            Requests from your storefront
          </div>
          <div className="text-[var(--dpf-muted)]" style={{ marginTop: 4, fontSize: 12 }}>
            Use <strong>Send inquiry to backlog</strong> on a request to track it as internal work you can follow up on. The customer isn&apos;t notified.
          </div>
        </div>
      ) : (
        <div
          className="border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]"
          style={{
            marginBottom: 16,
            padding: "12px 14px",
            borderRadius: 8,
            fontSize: 12,
          }}
        >
          Sending storefront requests to your backlog isn&apos;t available yet.
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        {["all", "inquiry", "booking", "order", "donation"].map((t) => (
          <button
            key={t}
            onClick={() => { setTypeFilter(t); setProviderFilter("all"); }}
            className={`border border-[var(--dpf-border)] ${typeFilter === t ? "bg-[var(--dpf-accent)] text-white" : ""}`}
            style={{
              padding: "4px 10px",
              borderRadius: 4,
              background: typeFilter === t ? undefined : "none",
              color: typeFilter === t ? undefined : "inherit",
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
            className="border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)]"
            style={{
              padding: "4px 10px",
              borderRadius: 4,
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

      {filtered.length === 0 && <p className="text-[var(--dpf-muted)]" style={{ fontSize: 13 }}>No entries yet.</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filtered.map((e) => (
          <div key={e.id} className="border border-[var(--dpf-border)]" style={{ padding: "12px 16px", borderRadius: 8 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline", marginBottom: 4, flexWrap: "wrap" }}>
              <span className="bg-[var(--dpf-surface-2)]" style={{ fontSize: 11, fontWeight: 700, padding: "1px 6px", borderRadius: 3 }}>
                {TYPE_LABELS[e.type] ?? e.type}
              </span>
              {e.type === "inquiry" && (
                <span
                  className="text-[var(--dpf-accent)]"
                  style={{
                    fontSize: 11,
                    padding: "1px 7px",
                    borderRadius: 10,
                    background: "color-mix(in srgb, var(--dpf-accent) 14%, transparent)",
                  }}
                >
                  New lead
                </span>
              )}
              <span style={{ fontSize: 12, fontFamily: "monospace" }}>{e.ref}</span>
              {e.type === "booking" && e.status && <StatusBadge status={e.status} />}
              {e.type === "booking" && e.providerName && (
                <span className="text-[var(--dpf-accent)]" style={{ fontSize: 11, padding: "1px 7px", borderRadius: 10, background: "rgba(79,70,229,0.12)" }}>
                  {e.providerName}
                </span>
              )}
              <span className="text-[var(--dpf-muted)]" style={{ fontSize: 11, marginLeft: "auto" }}>
                {new Date(e.createdAt).toLocaleDateString("en-GB")}
              </span>
            </div>
            <div style={{ fontSize: 13 }}>{e.name ?? "Anonymous"} · {e.email}</div>
            {e.type === "booking" ? (
              <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 2 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  {e.itemName ?? "Reservation"}
                  {e.whenLabel && <span className="text-[var(--dpf-muted)]" style={{ fontWeight: 400 }}> · {e.whenLabel}</span>}
                  {typeof e.covers === "number" && (
                    <span className="text-[var(--dpf-muted)]" style={{ fontWeight: 400 }}> · {e.covers} {e.covers === 1 ? "guest" : "guests"}</span>
                  )}
                </div>
                {e.dietaryNotes && (
                  <div className="text-[var(--dpf-muted)]" style={{ fontSize: 12 }}>
                    Dietary: {e.dietaryNotes}
                  </div>
                )}
                {e.nextAction && (
                  <div style={{ fontSize: 12, color: "var(--dpf-accent)" }}>
                    Next: {e.nextAction}
                  </div>
                )}
              </div>
            ) : (
              e.detail && <div className="text-[var(--dpf-muted)]" style={{ fontSize: 12, marginTop: 2 }}>{e.detail}</div>
            )}
            {e.type === "inquiry" && (() => {
              // A successful send stores the created itemId (BI-…); anything
              // else stored is an error message to surface for a retry.
              const clientState = productBacklogState[e.id];
              const clientItemId = clientState?.startsWith("BI-") ? clientState : null;
              const errorMessage = clientState && !clientState.startsWith("BI-") ? clientState : null;
              // Server-rendered link (existing item) OR the item we just made.
              const backlogItemId = e.backlogItemId ?? clientItemId;
              const isSending = pendingInquiryId === e.id;

              return (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    {backlogItemId ? (
                      // Terminal state: the inquiry is already tracked, so there is
                      // no enabled "Send to backlog" action — only a completed
                      // marker and a direct link to the created item.
                      <>
                        <span
                          className="text-[var(--dpf-success)]"
                          style={{ fontSize: 12, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5 }}
                        >
                          <span aria-hidden="true">✓</span> Sent to backlog
                        </span>
                        <a
                          href={`/ops?itemId=${encodeURIComponent(backlogItemId)}`}
                          className="text-[var(--dpf-accent)]"
                          style={{ fontSize: 12, textDecoration: "underline" }}
                          aria-label={`Open backlog item ${backlogItemId} for inquiry ${e.ref}`}
                        >
                          {backlogItemId}
                        </a>
                      </>
                    ) : (
                      <>
                        {/* Row-specific label + consequence copy so a non-technical
                            owner knows exactly which request this acts on and what
                            sending it changes (BI-F20763F5). */}
                        <button
                          onClick={() => sendInquiryToProductBacklog(e.id)}
                          disabled={!defaultDigitalProduct || isSending}
                          aria-label={`Send inquiry ${e.ref} to backlog`}
                          title={`Creates an internal work item from ${e.name ?? "this customer"}'s inquiry ${e.ref}. The customer is not notified.`}
                          className="border border-[var(--dpf-accent)] text-[var(--dpf-accent)]"
                          style={{
                            padding: "3px 10px",
                            borderRadius: 4,
                            background: "none",
                            cursor: !defaultDigitalProduct || isSending ? "not-allowed" : "pointer",
                            fontSize: 12,
                            opacity: !defaultDigitalProduct || isSending ? 0.6 : 1,
                          }}
                        >
                          {isSending ? "Sending…" : `Send inquiry ${e.ref} to backlog`}
                        </button>
                        {errorMessage && (
                          <span className="text-[var(--dpf-error)]" role="alert" style={{ fontSize: 12 }}>
                            {errorMessage}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  {!backlogItemId && (
                    <p className="text-[var(--dpf-muted)]" style={{ fontSize: 11, margin: 0 }}>
                      Creates an internal work item for your team to follow up. The customer isn&apos;t notified.
                    </p>
                  )}
                </div>
              );
            })()}
            {e.type === "booking" && (
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                {e.status === "pending" && (
                  <button
                    onClick={() => confirmBooking(e.id)}
                    aria-label={reservationActionLabel("Confirm", {
                      guestName: e.name,
                      itemName: e.itemName,
                      timeLabel: e.timeLabel,
                    })}
                    className="border border-[var(--dpf-success)] text-[var(--dpf-success)]"
                    style={{ padding: "3px 10px", borderRadius: 4, background: "none", cursor: "pointer", fontSize: 12 }}
                  >
                    Confirm
                  </button>
                )}
                {e.status !== "cancelled" && e.status !== "completed" && (
                  <button
                    onClick={() => cancelBooking(e.id)}
                    aria-label={reservationActionLabel("Cancel", {
                      guestName: e.name,
                      itemName: e.itemName,
                      timeLabel: e.timeLabel,
                    })}
                    className="border border-[var(--dpf-error)] text-[var(--dpf-error)]"
                    style={{ padding: "3px 10px", borderRadius: 4, background: "none", cursor: "pointer", fontSize: 12 }}
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
