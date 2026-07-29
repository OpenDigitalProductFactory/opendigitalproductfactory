// Order fulfilment handoff — the pure, shared vocabulary that turns a public
// storefront order into a traceable owner-facing fulfilment task (BI-115E0D1F).
//
// Mirrors booking-summary.ts for reservations: dependency-free (no prisma, no
// React) so the same lane backs the inbox rows, the status API's transition
// guard, and any future attention source without drift.

/** Canonical StorefrontOrder.status values. `pending` is the create-time
 *  default; everything else is owner-driven. Hyphenless single words, matching
 *  the reservation lane's style. */
export const ORDER_STATUSES = ["pending", "accepted", "ready", "fulfilled", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === "string" && (ORDER_STATUSES as readonly string[]).includes(value);
}

/** Legal forward transitions. Cancel is allowed from any non-terminal state;
 *  fulfilled/cancelled are terminal. */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ["accepted", "cancelled"],
  accepted: ["ready", "cancelled"],
  ready: ["fulfilled", "cancelled"],
  fulfilled: [],
  cancelled: [],
};

export function canTransitionOrder(from: string, to: string): boolean {
  if (!isOrderStatus(from) || !isOrderStatus(to)) return false;
  return ORDER_TRANSITIONS[from].includes(to);
}

/** The exact next action for an order at a given status — the "what to do"
 *  line for a non-technical owner, matching nextActionForReservation. Pure. */
export function nextActionForOrder(status: string): string {
  switch (status) {
    case "pending":
      return "Accept this order to start preparing it";
    case "accepted":
      return "In preparation — mark it ready when it's done";
    case "ready":
      return "Ready — hand it over, then mark it fulfilled";
    case "fulfilled":
      return "Fulfilled — no action needed";
    case "cancelled":
      return "Cancelled — no action needed";
    default:
      return "Review this order";
  }
}

/** One-line order contents summary for the inbox row, e.g.
 *  "2× Margherita Pizza" or "2× Tiramisu +1 more". Pure and defensive: the
 *  items column is free JSON, so unknown shapes degrade to a count. */
export function summarizeOrderItems(items: unknown): string | null {
  if (!Array.isArray(items) || items.length === 0) return null;
  const lines = items
    .filter((it): it is { qty?: unknown; name?: unknown } => typeof it === "object" && it !== null)
    .map((it) => {
      const name = typeof it.name === "string" && it.name.trim() ? it.name.trim() : null;
      const qty = typeof it.qty === "number" && it.qty > 0 ? it.qty : null;
      if (!name) return null;
      return qty ? `${qty}× ${name}` : name;
    })
    .filter((line): line is string => line !== null);
  if (lines.length === 0) return null;
  const [first, ...rest] = lines;
  return rest.length > 0 ? `${first} +${rest.length} more` : first;
}
