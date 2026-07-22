// Storefront demand → owner attention (BI-348766E5). The customer-facing revenue
// surface: unhandled inquiries and reservations that need an owner/staff decision.
// This is what makes Workspace the SINGLE owner-readable truth for restaurant demand
// — a pending reservation or unanswered enquiry projects into "Needs you" instead of
// living only in the storefront-local inbox, so the cockpit can never say "Nothing
// needs you right now" while a customer record is unhandled.
//
// Read-only pure mappers; source rows stay canonical in StorefrontInquiry /
// StorefrontBooking and nothing is persisted here (the §4.1 source-projection model
// of docs/superpowers/specs/2026-06-23-human-attention-surface-design.md). Each card
// carries the five facts an owner needs to act: guest/ref, table/service, date/time,
// status, and one exact next action.

import type { prisma } from "@dpf/db";
import type { AttentionItem } from "../types";
import { timeToActFromDeadline } from "../triage";

type Db = typeof prisma;

// ─── Actionable-state predicates ─────────────────────────────────────────────
// "Actionable" = the customer is still waiting on the business. Terminal / already
// handled states drop out so the surface reflects real outstanding demand, not the
// full history the storefront inbox lists.

const HANDLED_INQUIRY_STATUS = new Set(["responded", "resolved", "closed", "archived", "spam"]);

/** An inquiry needs the owner while it is neither handled nor terminal. The default
 *  status is "new"; "" (unset) is treated as new too. Pure. */
export function isActionableInquiry(status: string): boolean {
  return !HANDLED_INQUIRY_STATUS.has(status.trim().toLowerCase());
}

/** A reservation needs the owner while it awaits confirmation, OR while it is
 *  quarantined as a pre-existing double-booking (the overlap-exclusion review queue,
 *  EP-056D2A5E). A confirmed / completed / cancelled reservation is handled. Pure. */
export function isActionableBooking(row: { status: string; overlapQuarantinedAt: Date | null }): boolean {
  if (row.overlapQuarantinedAt != null) return true;
  return row.status.trim().toLowerCase() === "pending";
}

// ─── Row shapes (narrow selects; provider name is the table/service) ──────────

export type StorefrontInquiryRow = {
  id: string;
  inquiryRef: string;
  customerName: string | null;
  customerEmail: string;
  message: string | null;
  status: string;
  createdAt: Date;
};

export type StorefrontBookingRow = {
  id: string;
  bookingRef: string;
  customerName: string | null;
  customerEmail: string;
  scheduledAt: Date | null;
  status: string;
  overlapQuarantinedAt: Date | null;
  createdAt: Date;
  provider: { name: string } | null;
};

// ─── Pure formatting helpers (deterministic — no wall clock, no locale/TZ flake) ──

/** A human name for the guest, falling back to the email local-part, then a generic
 *  label — a card must never render a blank guest. Pure. */
export function displayGuest(name: string | null, email: string): string {
  const n = name?.trim();
  if (n) return n;
  const local = email.split("@")[0]?.trim();
  return local && local.length > 0 ? local : "A customer";
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A compact "Fri 25 Jul 19:00" from a Date, in UTC — deterministic for tests and
 *  consistent with the twin's UTC ISO date idiom. The precise-time "Due today"/"in N
 *  days" urgency tag is computed separately from `deadlineIso`. Pure. */
export function formatWhen(d: Date): string {
  const wd = WEEKDAYS[d.getUTCDay()];
  const day = d.getUTCDate();
  const mon = MONTHS[d.getUTCMonth()];
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${wd} ${day} ${mon} ${hh}:${mm}`;
}

/** The owner deep-link into the storefront inbox, focused on the one record. */
function inboxLink(entryId: string): string {
  return `/storefront/inbox?entryId=${encodeURIComponent(entryId)}`;
}

// ─── Mappers ─────────────────────────────────────────────────────────────────

/** Project an unhandled inquiry as a customer-waiting attention item. The situation
 *  line carries guest/ref, service, received date/time, and status; the single action
 *  is the exact next step (reply). Pure. */
export function inquiryToAttentionItem(row: StorefrontInquiryRow): AttentionItem {
  const guest = displayGuest(row.customerName, row.customerEmail);
  return {
    id: `storefront-demand:inquiry:${row.id}`,
    source: "storefront-demand",
    title: `Reply to ${guest}'s enquiry`,
    context: `${guest} · Enquiry · ${formatWhen(row.createdAt)} · Ref ${row.inquiryRef} · Awaiting reply`,
    decisionClass: { scorability: "unscorable" },
    riskClass: "bounded-write",
    portfolio: "products-and-services-sold",
    triage: {
      timeToAct: "none",
      residueReason: "customer-waiting",
      blastRadius: `${guest}'s enquiry`,
      decideEffort: "review",
      irreversible: false,
    },
    createdAtIso: row.createdAt.toISOString(),
    actions: [{ kind: "open-in-context", label: "Open enquiry", href: inboxLink(row.id) }],
    deepLink: inboxLink(row.id),
    audience: { operator: true },
    technical: {
      workType: "storefront-enquiry",
      ownershipDomain: "Products & services sold",
      detectedBy: "Storefront",
    },
  };
}

/** Project a pending or double-booked reservation as a customer-waiting attention
 *  item. A double-booking is high-risk (a table cannot serve two parties) and, once
 *  its slot is imminent/passed, floats to the override tier. Pure (nowMs injected). */
export function bookingToAttentionItem(row: StorefrontBookingRow, nowMs: number): AttentionItem {
  const guest = displayGuest(row.customerName, row.customerEmail);
  const service = row.provider?.name?.trim() || "Table service";
  const when = row.scheduledAt ? formatWhen(row.scheduledAt) : "time not set";
  const isException = row.overlapQuarantinedAt != null;
  const deadlineIso = row.scheduledAt ? row.scheduledAt.toISOString() : undefined;
  const statusLabel = isException ? "Double-booked" : "Awaiting confirmation";
  return {
    id: `storefront-demand:booking:${row.id}`,
    source: "storefront-demand",
    title: isException
      ? `Resolve ${guest}'s double-booked reservation`
      : `Confirm ${guest}'s reservation`,
    context: `${guest} · ${service} · ${when} · Ref ${row.bookingRef} · ${statusLabel}`,
    decisionClass: { scorability: "unscorable" },
    riskClass: isException ? "high-risk" : "bounded-write",
    portfolio: "products-and-services-sold",
    triage: {
      timeToAct: timeToActFromDeadline(deadlineIso, nowMs),
      deadlineIso,
      residueReason: "customer-waiting",
      blastRadius: `${guest}'s reservation`,
      decideEffort: "review",
      // A double-booking resolution rebooks or turns away a real guest — treat it as
      // irreversible so an imminent, high-risk conflict qualifies for the override tier.
      irreversible: isException,
    },
    createdAtIso: row.createdAt.toISOString(),
    actions: [
      {
        kind: "open-in-context",
        label: isException ? "Resolve double-booking" : "Confirm reservation",
        href: inboxLink(row.id),
      },
    ],
    deepLink: inboxLink(row.id),
    audience: { operator: true },
    technical: {
      workType: isException ? "reservation-exception" : "reservation",
      ownershipDomain: "Products & services sold",
      detectedBy: "Storefront",
    },
  };
}

// ─── Loader ──────────────────────────────────────────────────────────────────

/**
 * Load actionable storefront demand for the deployment's single org. Reads unhandled
 * inquiries and pending/quarantined reservations, projecting each into an attention
 * item. Ordered newest-first per stream; the aggregator re-orders across sources.
 */
export async function loadStorefrontDemandItems(db: Db): Promise<AttentionItem[]> {
  const nowMs = Date.now();
  const [inquiries, bookings] = await Promise.all([
    db.storefrontInquiry.findMany({
      where: { status: { notIn: [...HANDLED_INQUIRY_STATUS] } },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        inquiryRef: true,
        customerName: true,
        customerEmail: true,
        message: true,
        status: true,
        createdAt: true,
      },
    }),
    db.storefrontBooking.findMany({
      where: { OR: [{ status: "pending" }, { overlapQuarantinedAt: { not: null } }] },
      orderBy: { scheduledAt: "asc" },
      take: 50,
      select: {
        id: true,
        bookingRef: true,
        customerName: true,
        customerEmail: true,
        scheduledAt: true,
        status: true,
        overlapQuarantinedAt: true,
        createdAt: true,
        provider: { select: { name: true } },
      },
    }),
  ]);

  const items: AttentionItem[] = [];
  for (const row of inquiries as StorefrontInquiryRow[]) {
    if (isActionableInquiry(row.status)) items.push(inquiryToAttentionItem(row));
  }
  for (const row of bookings as StorefrontBookingRow[]) {
    if (isActionableBooking(row)) items.push(bookingToAttentionItem(row, nowMs));
  }
  return items;
}
