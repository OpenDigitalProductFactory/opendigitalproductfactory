"use client";
import { useState } from "react";
import { confirmDialog, promptDialog } from "@/components/ui/Dialog";
import { reservationActionLabel } from "@/lib/storefront/booking-summary";
import { type OrderStatus } from "@/lib/storefront/order-lifecycle";

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
  // Order fulfilment lane (BI-115E0D1F).
  accepted: { background: "rgba(79,70,229,0.15)", color: "var(--dpf-accent)" },
  ready: { background: "color-mix(in srgb, var(--dpf-success) 15%, transparent)", color: "var(--dpf-success)" },
  fulfilled: { background: "rgba(79,70,229,0.15)", color: "var(--dpf-accent)" },
};

// The owner-facing verb that moves an order forward from each lane status.
const ORDER_ADVANCE: Record<string, { to: OrderStatus; verb: string; done: string } | undefined> = {
  pending: { to: "accepted", verb: "Accept order", done: "Accepted — it's now in preparation." },
  accepted: { to: "ready", verb: "Mark ready", done: "Ready — hand it over and mark it fulfilled." },
  ready: { to: "fulfilled", verb: "Mark fulfilled", done: "Fulfilled — this order is complete." },
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
  // Row-specific booking action result state: an owner must see whether a
  // confirm/cancel is in flight, succeeded, or failed — never a silent reload
  // that hides a failed POST (BI-3DA1DFDC).
  const [bookingAction, setBookingAction] = useState<
    Record<string, { phase: "pending" | "done" | "error"; message: string }>
  >({});
  // Successful actions update the row's visible status without a full reload,
  // so the success note and the new status stay on screen together.
  const [statusOverride, setStatusOverride] = useState<Record<string, string>>({});

  const filtered = entries.filter((e) => {
    if (typeFilter !== "all" && e.type !== typeFilter) return false;
    if (typeFilter === "booking" && providerFilter !== "all" && e.providerName !== providerFilter) return false;
    return true;
  });

  function bookingLabelParts(e: Entry) {
    return { guestName: e.name, itemName: e.itemName, timeLabel: e.timeLabel };
  }

  async function runBookingAction(
    e: Entry,
    opts: {
      pendingMessage: string;
      successStatus: string;
      successMessage: string;
      failureMessage: string;
      request: () => Promise<Response>;
    },
  ) {
    setBookingAction((s) => ({ ...s, [e.id]: { phase: "pending", message: opts.pendingMessage } }));
    try {
      const res = await opts.request();
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        // Booking routes return { error }; envelope routes return { message }.
        const detail =
          typeof body.error === "string" ? body.error
          : typeof body.message === "string" ? body.message
          : opts.failureMessage;
        throw new Error(detail);
      }
      setStatusOverride((s) => ({ ...s, [e.id]: opts.successStatus }));
      setBookingAction((s) => ({ ...s, [e.id]: { phase: "done", message: opts.successMessage } }));
    } catch (error) {
      const message = error instanceof Error ? error.message : opts.failureMessage;
      setBookingAction((s) => ({
        ...s,
        [e.id]: { phase: "error", message: `${message} The booking is unchanged — try again.` },
      }));
    }
  }

  async function cancelBooking(e: Entry) {
    // Name the exact reservation in the dialog so the owner reviews what they
    // are cancelling — guest, table/service, time — plus the consequence.
    const reason = await promptDialog({
      title: reservationActionLabel("Cancel", bookingLabelParts(e)),
      message: `Booking ${e.ref}. The guest will see this booking as cancelled. Cancellation reason:`,
      confirmLabel: "Cancel booking",
      cancelLabel: "Keep booking",
    });
    if (reason === null) return; // user dismissed
    await runBookingAction(e, {
      pendingMessage: "Cancelling…",
      successStatus: "cancelled",
      successMessage: "Cancelled — the guest sees this booking as cancelled.",
      failureMessage: "Couldn't cancel the booking.",
      request: () =>
        fetch(`/api/storefront/bookings/${e.id}/cancel`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        }),
    });
  }

  async function confirmBooking(e: Entry) {
    // Pre-action review with consequence copy: exactly which reservation, and
    // what confirming changes for the guest (BI-3DA1DFDC).
    const ok = await confirmDialog({
      title: reservationActionLabel("Confirm", bookingLabelParts(e)),
      message: `Booking ${e.ref}. The guest's booking becomes confirmed. You can still cancel later with a reason.`,
      confirmLabel: "Confirm booking",
      cancelLabel: "Not yet",
    });
    if (!ok) return;
    await runBookingAction(e, {
      pendingMessage: "Confirming…",
      successStatus: "confirmed",
      successMessage: "Confirmed — the guest's booking is now confirmed.",
      failureMessage: "Couldn't confirm the booking.",
      request: () => fetch(`/api/storefront/bookings/${e.id}/confirm`, { method: "POST" }),
    });
  }

  async function advanceOrder(e: Entry, to: OrderStatus, doneMessage: string) {
    await runBookingAction(e, {
      pendingMessage: "Updating…",
      successStatus: to,
      successMessage: doneMessage,
      failureMessage: "Couldn't update the order.",
      request: () =>
        fetch(`/api/storefront/orders/${e.id}/status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: to }),
        }),
    });
  }

  async function cancelOrder(e: Entry) {
    const ok = await confirmDialog({
      title: `Cancel order ${e.ref}`,
      message: `Order ${e.ref}${e.name ? ` for ${e.name}` : ""}. The order becomes cancelled and won't be prepared.`,
      confirmLabel: "Cancel order",
      cancelLabel: "Keep order",
    });
    if (!ok) return;
    await advanceOrder(e, "cancelled", "Cancelled — this order won't be prepared.");
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

      <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
        {["all", "inquiry", "booking", "order", "donation"].map((t) => (
          <button
            key={t}
            onClick={() => { setTypeFilter(t); setProviderFilter("all"); }}
            aria-pressed={typeFilter === t}
            aria-label={`Filter requests: ${t === "all" ? "All" : TYPE_LABELS[t]}`}
            className={`dpf-tap-target border border-[var(--dpf-border)] ${typeFilter === t ? "bg-[var(--dpf-accent)] text-white" : ""}`}
            style={{
              padding: "4px 12px",
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
            aria-label="Filter bookings by provider"
            className="dpf-tap-target border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)]"
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
      {/* Announce the active filter + result count so the chips aren't a silent
          visual-only state (BI-4F4252DB follow-through). */}
      <p role="status" className="text-[var(--dpf-muted)]" style={{ fontSize: 12, margin: "0 0 16px" }}>
        Showing {filtered.length} of {entries.length} requests
        {typeFilter !== "all" ? ` — ${TYPE_LABELS[typeFilter]} filter on` : ""}
      </p>

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
              {(e.type === "booking" || e.type === "order") && (statusOverride[e.id] ?? e.status) && (
                <StatusBadge status={statusOverride[e.id] ?? e.status} />
              )}
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
            ) : e.type === "order" ? (
              <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 2 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  {e.itemName ?? "Order"}
                  {e.detail && <span className="text-[var(--dpf-muted)]" style={{ fontWeight: 400 }}> · {e.detail}</span>}
                </div>
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
                          className="dpf-tap-target text-[var(--dpf-accent)]"
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
                          className="dpf-tap-target border border-[var(--dpf-accent)] text-[var(--dpf-accent)]"
                          style={{
                            padding: "3px 12px",
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
            {e.type === "order" && (() => {
              const status = statusOverride[e.id] ?? e.status;
              const action = bookingAction[e.id];
              const busy = action?.phase === "pending";
              const advance = ORDER_ADVANCE[status];
              const cancellable = status !== "fulfilled" && status !== "cancelled";
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {advance && (
                      <button
                        onClick={() => advanceOrder(e, advance.to, advance.done)}
                        disabled={busy}
                        aria-label={`${advance.verb} ${e.ref}`}
                        className="dpf-tap-target border border-[var(--dpf-success)] text-[var(--dpf-success)]"
                        style={{
                          padding: "3px 12px",
                          borderRadius: 4,
                          background: "none",
                          cursor: busy ? "wait" : "pointer",
                          fontSize: 12,
                          opacity: busy ? 0.6 : 1,
                        }}
                      >
                        {busy ? "Working…" : advance.verb}
                      </button>
                    )}
                    {cancellable && (
                      <button
                        onClick={() => cancelOrder(e)}
                        disabled={busy}
                        aria-label={`Cancel order ${e.ref}`}
                        className="dpf-tap-target border border-[var(--dpf-error)] text-[var(--dpf-error)]"
                        style={{
                          padding: "3px 12px",
                          borderRadius: 4,
                          background: "none",
                          cursor: busy ? "wait" : "pointer",
                          fontSize: 12,
                          opacity: busy ? 0.6 : 1,
                        }}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                  {action && (
                    <span
                      role={action.phase === "error" ? "alert" : "status"}
                      className={
                        action.phase === "error"
                          ? "text-[var(--dpf-error)]"
                          : action.phase === "done"
                            ? "text-[var(--dpf-success)]"
                            : "text-[var(--dpf-muted)]"
                      }
                      style={{ fontSize: 12 }}
                    >
                      {action.message}
                    </span>
                  )}
                </div>
              );
            })()}
            {e.type === "booking" && (() => {
              const status = statusOverride[e.id] ?? e.status;
              const action = bookingAction[e.id];
              const busy = action?.phase === "pending";
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {status === "pending" && (
                      <button
                        onClick={() => confirmBooking(e)}
                        disabled={busy}
                        aria-label={reservationActionLabel("Confirm", bookingLabelParts(e))}
                        className="dpf-tap-target border border-[var(--dpf-success)] text-[var(--dpf-success)]"
                        style={{
                          padding: "3px 12px",
                          borderRadius: 4,
                          background: "none",
                          cursor: busy ? "wait" : "pointer",
                          fontSize: 12,
                          opacity: busy ? 0.6 : 1,
                        }}
                      >
                        {busy ? "Working…" : "Confirm"}
                      </button>
                    )}
                    {status !== "cancelled" && status !== "completed" && (
                      <button
                        onClick={() => cancelBooking(e)}
                        disabled={busy}
                        aria-label={reservationActionLabel("Cancel", bookingLabelParts(e))}
                        className="dpf-tap-target border border-[var(--dpf-error)] text-[var(--dpf-error)]"
                        style={{
                          padding: "3px 12px",
                          borderRadius: 4,
                          background: "none",
                          cursor: busy ? "wait" : "pointer",
                          fontSize: 12,
                          opacity: busy ? 0.6 : 1,
                        }}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                  {/* Row-specific action result: pending, success, or a failure the
                      owner can retry — never a silent reload (BI-3DA1DFDC). */}
                  {action && (
                    <span
                      role={action.phase === "error" ? "alert" : "status"}
                      className={
                        action.phase === "error"
                          ? "text-[var(--dpf-error)]"
                          : action.phase === "done"
                            ? "text-[var(--dpf-success)]"
                            : "text-[var(--dpf-muted)]"
                      }
                      style={{ fontSize: 12 }}
                    >
                      {action.message}
                    </span>
                  )}
                </div>
              );
            })()}
          </div>
        ))}
      </div>
    </div>
  );
}
