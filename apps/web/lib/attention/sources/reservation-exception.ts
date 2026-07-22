// Reservation-exception source — projects public StorefrontBooking rows that need
// the OWNER's attention as first-class, customer-facing attention items, so a
// restaurant reservation shows up as the owner's next task instead of being lost
// among generic coworker decision cards (BI-3DA1DFDC).
//
// Spec: docs/superpowers/specs/2026-06-23-human-attention-surface-design.md §4.1.
// A booking is an EXCEPTION requiring a human when it is:
//   - `pending`          — a guest is waiting on confirm/decline,
//   - `needs-reschedule` — the owner owes the guest a new time,
//   - overlap-quarantined — two reservations collided and one is parked for review.
// Confirmed / completed / cancelled bookings are settled and never surface here.
//
// Pure mapper (nowMs injected for the deadline tier) + a thin db loader, mirroring
// the business-approvals source shape. Read-only: never mutates a booking row.

import type { prisma } from "@dpf/db";
import type { AttentionItem } from "../types";
import { timeToActFromDeadline } from "../triage";
import { formatReservationWhen, nextActionForReservation } from "@/lib/storefront/booking-summary";

type Db = typeof prisma;

export type ReservationExceptionRow = {
  bookingId: string;
  bookingRef: string;
  customerName: string;
  itemName: string | null;
  scheduledAt: Date;
  covers: number | null;
  status: string;
  overlapQuarantinedAt: Date | null;
  createdAt: Date;
  /** Storefront timezone so the surfaced time is the guest's local slot. */
  timezone: string;
};

/** Project one booking exception into an attention item. Pure (nowMs injected). */
export function reservationExceptionToAttentionItem(
  row: ReservationExceptionRow,
  nowMs: number,
): AttentionItem {
  const when = formatReservationWhen(row.scheduledAt, row.timezone);
  const what = row.itemName ?? "Reservation";
  const coversSuffix = typeof row.covers === "number" ? `, ${row.covers} ${row.covers === 1 ? "guest" : "guests"}` : "";
  const quarantined = row.overlapQuarantinedAt != null;

  // The deadline that governs urgency is the reservation time itself: a booking
  // tonight needs a decision today. An overlap is a today-problem regardless.
  const deadlineIso = row.scheduledAt.toISOString();
  const timeToAct = quarantined ? "due-today" : timeToActFromDeadline(deadlineIso, nowMs);

  const title = quarantined
    ? `Resolve double-booking: ${row.customerName}`
    : row.status === "needs-reschedule"
      ? `Reschedule ${row.customerName}`
      : `Confirm ${row.customerName}, ${what} at ${when.timeLabel}`;

  const context = `${what}${coversSuffix} · ${when.whenLabel}`;
  const blastRadius = quarantined
    ? "two reservations that overlap"
    : `${row.customerName}${what !== "Reservation" ? `, ${what}` : ""} at ${when.timeLabel}`;

  return {
    id: `reservation-exception:${row.bookingRef}`,
    source: "reservation-exception",
    title,
    context,
    decisionClass: { scorability: "unscorable" },
    riskClass: quarantined ? "high-risk" : "bounded-write",
    triage: {
      timeToAct,
      deadlineIso,
      residueReason: quarantined ? "principle-conflict" : "input-required",
      blastRadius,
      decideEffort: "review",
      irreversible: false,
    },
    createdAtIso: row.createdAt.toISOString(),
    // Customer-facing revenue surface — surfaces OUTSIDE-IN, ahead of and separate
    // from for-employees coworker decision cards.
    portfolio: "products-and-services-sold",
    actions: [{ kind: "open-in-context", label: "Open reservation", href: "/storefront/inbox" }],
    deepLink: "/storefront/inbox",
    audience: { operator: true },
    technical: { workType: nextActionForReservation(row.status) },
  };
}

const OPEN_EXCEPTION_STATUSES = ["pending", "needs-reschedule"];

/** Load the open reservation exceptions across the install's storefront. */
export async function loadReservationExceptionItems(db: Db): Promise<AttentionItem[]> {
  const nowMs = Date.now();
  const config = await db.storefrontConfig.findFirst({ select: { id: true, timezone: true } });
  if (!config) return [];

  const rows = await db.storefrontBooking.findMany({
    where: {
      storefrontId: config.id,
      OR: [{ status: { in: OPEN_EXCEPTION_STATUSES } }, { overlapQuarantinedAt: { not: null } }],
    },
    orderBy: { scheduledAt: "asc" },
    take: 50,
    select: {
      id: true,
      bookingRef: true,
      itemId: true,
      customerName: true,
      scheduledAt: true,
      covers: true,
      status: true,
      overlapQuarantinedAt: true,
      createdAt: true,
    },
  });
  if (rows.length === 0) return [];

  const itemIds = [...new Set(rows.map((r) => r.itemId))];
  const itemNameById = new Map(
    (
      await db.storefrontItem.findMany({
        where: { id: { in: itemIds } },
        select: { id: true, name: true },
      })
    ).map((item) => [item.id, item.name]),
  );

  return rows.map((r) =>
    reservationExceptionToAttentionItem(
      {
        bookingId: r.id,
        bookingRef: r.bookingRef,
        customerName: r.customerName,
        itemName: itemNameById.get(r.itemId) ?? null,
        scheduledAt: r.scheduledAt,
        covers: r.covers,
        status: r.status,
        overlapQuarantinedAt: r.overlapQuarantinedAt,
        createdAt: r.createdAt,
        timezone: config.timezone,
      },
      nowMs,
    ),
  );
}
