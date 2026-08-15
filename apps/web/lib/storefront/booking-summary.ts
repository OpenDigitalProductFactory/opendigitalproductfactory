// Reservation handoff — the pure, shared vocabulary that turns a public booking
// intent into a traceable owner-facing reservation task (BI-3DA1DFDC).
//
// Deliberately dependency-free (no prisma, no React) so the SAME logic backs three
// surfaces without drift:
//   1. the public booking form (SlotBookingFlow) — what to capture / what to drop,
//   2. the owner storefront inbox — the row summary + accessible action labels,
//   3. the workspace reservation-exception attention source — the "who's waiting" line.
//
// A single source of truth for the handoff copy means "Confirm Jane Smith, Table for
// 2 at 6:30 PM" reads the same wherever the owner meets it.

// ─── Structured booking field roles ──────────────────────────────────────────
//
// An archetype's inquiry formSchema is reused for the booking contact step. Which
// of those fields still render is owned by slot-booking-fields.ts's
// `slotFlowExtraFields` (it drops the contact + slot-derived date/time fields).
// This module owns the remaining question: of the fields that DO render, which
// belong in a structured booking column (covers, dietary) rather than free-text
// notes, plus the handoff vocabulary shared with the inbox + attention source.

const COVERS_FIELD_NAMES: ReadonlySet<string> = new Set(["covers", "partysize", "party_size", "guests", "guestcount", "guest_count"]);
const DIETARY_FIELD_NAMES: ReadonlySet<string> = new Set(["dietary", "dietaryrequirements", "dietary_requirements", "dietarynotes", "dietary_notes", "allergies"]);

function norm(name: string): string {
  return name.trim().toLowerCase();
}

/** The structured column a schema field maps to, or null for a free-text extra.
 *  Lets the booking carry covers + dietary as first-class facts. Pure. */
export function structuredBookingFieldRole(name: string): "covers" | "dietary" | null {
  const n = norm(name);
  if (COVERS_FIELD_NAMES.has(n)) return "covers";
  if (DIETARY_FIELD_NAMES.has(n)) return "dietary";
  return null;
}

/** Parse a covers/party-size control value ("2", "10+") into a count. Pure. */
export function parseCovers(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const match = raw.match(/\d+/);
  if (!match) return null;
  const n = Number.parseInt(match[0], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ─── Reservation summary + owner copy ─────────────────────────────────────────

export type ReservationStatus =
  | "pending"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "needs-reschedule";

/** Format an inbox intake instant in the business timezone before it crosses
 *  the server/client boundary. Rendering the ISO value with the browser's
 *  locale can disagree with the server near midnight and break hydration. */
export function formatInboxCreatedDate(createdAt: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(createdAt);
}

/** Format a booking's scheduled instant for owner-facing surfaces, in the
 *  storefront's own timezone so "6:30 PM" is the guest's local slot. Pure given a
 *  fixed timezone (Intl is deterministic). */
export function formatReservationWhen(
  scheduledAt: Date,
  timezone: string,
): { dateLabel: string; timeLabel: string; whenLabel: string } {
  const dateLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(scheduledAt);
  const timeLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(scheduledAt);
  return { dateLabel, timeLabel, whenLabel: `${dateLabel}, ${timeLabel}` };
}

/** The exact next action for a reservation at a given status — the "what to do"
 *  line that makes the handoff traceable for a non-technical owner. Pure. */
export function nextActionForReservation(status: string): string {
  switch (status) {
    case "pending":
      return "Confirm or decline this reservation";
    case "confirmed":
      return "Confirmed — get the table ready";
    case "needs-reschedule":
      return "Offer the guest a new time";
    case "cancelled":
      return "Cancelled — no action needed";
    case "completed":
      return "Completed — no action needed";
    default:
      return "Review this reservation";
  }
}

/** The row-specific, screen-reader-friendly action label an owner acts on, e.g.
 *  "Confirm Jane Smith, Table for 2 at 6:30 PM". Degrades gracefully when a fact
 *  is missing. Pure. */
export function reservationActionLabel(
  verb: string,
  parts: { guestName?: string | null; itemName?: string | null; timeLabel?: string | null },
): string {
  const segments: string[] = [verb];
  const who = parts.guestName?.trim();
  const what = parts.itemName?.trim();
  const when = parts.timeLabel?.trim();
  const tail: string[] = [];
  if (who) tail.push(who);
  if (what) tail.push(what);
  let label = segments.join(" ");
  if (tail.length > 0) label += ` ${tail.join(", ")}`;
  if (when) label += ` at ${when}`;
  return label;
}
