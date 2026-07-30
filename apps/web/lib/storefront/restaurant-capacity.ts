// apps/web/lib/storefront/restaurant-capacity.ts
//
// The single source of truth for a Restaurant install's capacity state — a pure,
// DB-free projection over the structured Food & Hospitality resource/capacity
// substrate. Every owner and customer surface renders from this one shape so
// Tables & Capacity, Operations, and booking availability reconcile.
//
// Nouns (table/tables, waitlist, reservations) come from the FLOOR twin profile
// (`deriveTwinProfile`) — the operational-twin framework is the noun SSOT; this
// module never re-authors them.
//
// Design: docs/superpowers/specs/2026-07-22-restaurant-capacity-legibility-design.md

import { resolveIntent, type Intent } from "@/components/ui/report-kit/statusColors";
import {
  isHospitalityResourceAvailableForInterval,
  type HospitalityAvailabilityWindow,
  type HospitalityAllocationLifecycle,
  type HospitalityCapacityUnit,
  type HospitalityResourceKind,
  type HospitalityResourceStatus,
} from "./hospitality-capacity";

// ── Canonical capacity vocabulary ───────────────────────────────────────────

/** The owner-readable state of one physical table / seating resource. */
export type TableCapacityState =
  | "available" // open and bookable now
  | "occupied" // a party is seated / a confirmed booking spans now
  | "turning-soon" // occupied, but the current sitting ends within the turn window
  | "blocked"; // out of service (maintenance / owner hold)

export const TABLE_CAPACITY_STATES: readonly TableCapacityState[] = [
  "available",
  "occupied",
  "turning-soon",
  "blocked",
] as const;

/** Whether the next service period can open with confidence. */
export type ServicePeriodReadiness = "ready" | "attention" | "not-ready" | "closed";

export interface RestaurantTable {
  key: string;
  /** "Table 4", "Window 2" — the operator's own label. */
  label: string;
  /** Seats, when the label / linked offer makes it knowable; null otherwise. */
  seats: number | null;
  state: TableCapacityState;
  /** Minutes until a `turning-soon` table frees up; null otherwise. */
  freeInMinutes: number | null;
}

export interface ServicePeriod {
  key: string; // "lunch" | "dinner" | a numbered sitting
  label: string;
  startsAt: Date;
  endsAt: Date;
}

export interface RestaurantCapacitySnapshot {
  tables: RestaurantTable[];
  counts: Record<TableCapacityState, number>;
  totalTables: number;
  /** Sum of known seat counts; null when no table exposes a seat count. */
  seatsTotal: number | null;
  /** Parties waiting with no seat yet (walk-in / unrouted demand). */
  waitlistParties: number;
  /** In-flight work items (confirmed / seated bookings) consuming capacity. */
  ticketsOpen: number;
  /** Confirmed reservations still ahead in the current/next period. */
  upcomingReservations: number;
  /** Reservations awaiting owner confirmation (the reconciliation signal). */
  pendingReservations: number;
  nextPeriod: ServicePeriod | null;
  readiness: ServicePeriodReadiness;
  /** The ONE thing the owner should do next — null when nothing is pending. */
  nextAction: { label: string; href: string } | null;
}

// ── Structural inputs (satisfied by Prisma rows and by test fakes) ───────────

export interface CapacityResourceInput {
  id: string;
  label: string;
  kind: HospitalityResourceKind;
  status: HospitalityResourceStatus;
  capacity: number;
  capacityUnit: HospitalityCapacityUnit;
  availability?: CapacityAvailabilityInput[];
}

export type CapacityAvailabilityInput = HospitalityAvailabilityWindow;

export interface CapacityBookingInput {
  id: string;
  hospitalityResourceId: string | null;
  scheduledAt: Date | null;
  durationMinutes: number | null;
  status: string;
}

export interface CapacityHoldInput {
  hospitalityResourceId?: string | null;
  slotStart: Date | null;
  slotEnd: Date | null;
}

export interface CapacityAllocationInput {
  id: string;
  resourceId: string | null;
  startsAt: Date;
  endsAt: Date;
  lifecycle: HospitalityAllocationLifecycle;
}

// ── State + intent mapping ───────────────────────────────────────────────────

const STATE_LABEL: Record<TableCapacityState, string> = {
  available: "Available",
  occupied: "Occupied",
  "turning-soon": "Turning soon",
  blocked: "Blocked",
};

// Colors resolve through the central statusColors registry (domain
// "restaurantCapacity"), never a local status→color map (AGENTS.md §12).
export function capacityStateIntent(state: TableCapacityState): Intent {
  return resolveIntent("restaurantCapacity", state);
}

export function capacityStateLabel(state: TableCapacityState): string {
  return STATE_LABEL[state];
}

/** An operating window: day-of-week (0=Sun) + local HH:mm open/close. */
export interface OperatingWindow {
  day: number;
  start: string;
  end: string;
}

function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(":");
  return (Number(h) || 0) * 60 + (Number(m) || 0);
}

function periodLabel(startMinutes: number): string {
  if (startMinutes < 11 * 60) return "breakfast service";
  if (startMinutes < 16 * 60) return "lunch service";
  return "dinner service";
}

/**
 * Resolve the current-or-next service period from operating windows. Returns the
 * window spanning `now` if the venue is open, otherwise the soonest upcoming
 * window within the next 7 days. Null when there are no windows (the "closed"
 * readiness case). Pure and total.
 */
export function resolveServicePeriod(windows: OperatingWindow[], now: Date): ServicePeriod | null {
  if (windows.length === 0) return null;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const today = now.getDay();

  // Open right now?
  for (const w of windows) {
    if (w.day !== today) continue;
    const s = hmToMinutes(w.start);
    const e = hmToMinutes(w.end);
    if (nowMin >= s && nowMin < e) {
      return makePeriod(now, 0, s, e);
    }
  }
  // Soonest upcoming window in the next 7 days.
  for (let offset = 0; offset < 7; offset++) {
    const day = (today + offset) % 7;
    const candidates = windows
      .filter((w) => w.day === day)
      .filter((w) => offset > 0 || hmToMinutes(w.start) > nowMin)
      .sort((a, b) => hmToMinutes(a.start) - hmToMinutes(b.start));
    if (candidates[0]) {
      const s = hmToMinutes(candidates[0].start);
      const e = hmToMinutes(candidates[0].end);
      return makePeriod(now, offset, s, e);
    }
  }
  return null;
}

function makePeriod(now: Date, dayOffset: number, startMin: number, endMin: number): ServicePeriod {
  const base = new Date(now);
  base.setDate(base.getDate() + dayOffset);
  const startsAt = new Date(base);
  startsAt.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0);
  const endsAt = new Date(base);
  endsAt.setHours(Math.floor(endMin / 60), endMin % 60, 0, 0);
  return { key: `period-${startMin}`, label: periodLabel(startMin), startsAt, endsAt };
}

export function readinessIntent(readiness: ServicePeriodReadiness): Intent {
  return resolveIntent("servicePeriodReadiness", readiness);
}

// ── Booking-status helpers ───────────────────────────────────────────────────

const ACTIVE_STATUSES = new Set(["confirmed", "scheduled", "in_progress", "inprogress", "seated"]);
const PENDING_STATUSES = new Set(["pending", "requested", "unconfirmed"]);
const CLOSED_STATUSES = new Set(["cancelled", "canceled", "completed", "no_show", "no-show", "void"]);

function isActiveBooking(b: CapacityBookingInput): boolean {
  return ACTIVE_STATUSES.has(b.status.toLowerCase());
}
function isPendingBooking(b: CapacityBookingInput): boolean {
  return PENDING_STATUSES.has(b.status.toLowerCase());
}
function isOpenBooking(b: CapacityBookingInput): boolean {
  return !CLOSED_STATUSES.has(b.status.toLowerCase());
}

/** Does a scheduled booking's sitting span `now`? */
function spansNow(b: CapacityBookingInput, now: Date): { seated: boolean; freeInMinutes: number } {
  if (!b.scheduledAt) return { seated: false, freeInMinutes: 0 };
  const start = b.scheduledAt.getTime();
  const end = start + (b.durationMinutes ?? 90) * 60_000;
  const t = now.getTime();
  if (t < start || t >= end) return { seated: false, freeInMinutes: 0 };
  return { seated: true, freeInMinutes: Math.max(0, Math.round((end - t) / 60_000)) };
}

function resourceAvailableAt(
  resource: CapacityResourceInput,
  now: Date,
  timeZone: string,
): boolean {
  return isHospitalityResourceAvailableForInterval({
    availability: resource.availability ?? [],
    startsAt: now,
    endsAt: new Date(now.getTime() + 60_000),
    timeZone,
  });
}

// ── The projection ───────────────────────────────────────────────────────────

export interface DeriveCapacityInput {
  resources: CapacityResourceInput[];
  bookings: CapacityBookingInput[];
  allocations?: CapacityAllocationInput[];
  holds?: CapacityHoldInput[];
  now: Date;
  nextPeriod?: ServicePeriod | null;
  /** Minutes-remaining threshold below which an occupied table is "turning soon". */
  turnWindowMinutes?: number;
  /** Base path for the owner next-action links. */
  ownerBasePath?: string;
  /** IANA timezone used to interpret recurring hours and dated exceptions. */
  timeZone?: string;
}

/**
 * Fold the live substrate into one owner-readable capacity snapshot. Total and
 * fail-soft: an empty install yields a coherent "no tables yet" snapshot, never
 * a throw.
 */
export function deriveRestaurantCapacity(input: DeriveCapacityInput): RestaurantCapacitySnapshot {
  const {
    resources,
    bookings,
    allocations = [],
    holds = [],
    now,
    nextPeriod = null,
    turnWindowMinutes = 20,
    ownerBasePath = "/storefront",
    timeZone = "UTC",
  } = input;

  const tableRows = resources.filter((resource) => resource.kind === "table");
  const openBookings = bookings.filter(isOpenBooking);

  // Index active/seated bookings + holds by the table they consume.
  const seatedByTable = new Map<string, number>(); // freeInMinutes (0 = not turning)
  for (const allocation of allocations) {
    if (
      !allocation.resourceId ||
      (allocation.lifecycle !== "reserved" &&
        allocation.lifecycle !== "active") ||
      allocation.startsAt.getTime() > now.getTime() ||
      allocation.endsAt.getTime() <= now.getTime()
    ) {
      continue;
    }
    const freeInMinutes = Math.max(
      0,
      Math.round(
        (allocation.endsAt.getTime() - now.getTime()) / 60_000,
      ),
    );
    const previous = seatedByTable.get(allocation.resourceId);
    if (previous === undefined || freeInMinutes > previous) {
      seatedByTable.set(allocation.resourceId, freeInMinutes);
    }
  }
  for (const b of openBookings) {
    if (!b.hospitalityResourceId || !isActiveBooking(b)) continue;
    const { seated, freeInMinutes } = spansNow(b, now);
    if (!seated) continue;
    const prev = seatedByTable.get(b.hospitalityResourceId);
    // Keep the sitting that frees latest (the table stays occupied until then).
    if (prev === undefined || freeInMinutes > prev) {
      seatedByTable.set(b.hospitalityResourceId, freeInMinutes);
    }
  }
  const heldTables = new Set<string>();
  for (const h of holds) {
    if (!h.hospitalityResourceId || !h.slotStart || !h.slotEnd) continue;
    if (h.slotStart.getTime() <= now.getTime() && now.getTime() < h.slotEnd.getTime()) {
      heldTables.add(h.hospitalityResourceId);
    }
  }

  const counts: Record<TableCapacityState, number> = {
    available: 0,
    occupied: 0,
    "turning-soon": 0,
    blocked: 0,
  };
  let seatsKnown = false;
  let seatsTotal = 0;

  const tables: RestaurantTable[] = tableRows.map((r) => {
    const seats = r.capacityUnit === "seats" ? r.capacity : null;
    if (seats != null) {
      seatsKnown = true;
      seatsTotal += seats;
    }
    let state: TableCapacityState;
    let freeInMinutes: number | null = null;
    if (r.status !== "active" || !resourceAvailableAt(r, now, timeZone)) {
      state = "blocked";
    } else if (seatedByTable.has(r.id)) {
      const remaining = seatedByTable.get(r.id)!;
      if (remaining <= turnWindowMinutes) {
        state = "turning-soon";
        freeInMinutes = remaining;
      } else {
        state = "occupied";
      }
    } else if (heldTables.has(r.id)) {
      state = "occupied"; // a live hold occupies the table for the customer completing checkout
    } else {
      state = "available";
    }
    counts[state] += 1;
    return { key: r.id, label: r.label, seats, state, freeInMinutes };
  });

  // Demand signals.
  const waitlistParties = openBookings.filter(
    (b) =>
      (isPendingBooking(b) || b.hospitalityResourceId == null) &&
      b.scheduledAt == null,
  ).length;
  const ticketsOpen = openBookings.filter(isActiveBooking).length;
  const pendingReservations = openBookings.filter(isPendingBooking).length;
  const upcomingReservations = openBookings.filter(
    (b) => isActiveBooking(b) && b.scheduledAt != null && b.scheduledAt.getTime() > now.getTime(),
  ).length;

  const readiness = deriveReadiness({
    totalTables: tables.length,
    counts,
    pendingReservations,
    nextPeriod,
    now,
  });

  const nextAction = deriveNextAction({
    counts,
    waitlistParties,
    pendingReservations,
    totalTables: tables.length,
    ownerBasePath,
  });

  return {
    tables,
    counts,
    totalTables: tables.length,
    seatsTotal: seatsKnown ? seatsTotal : null,
    waitlistParties,
    ticketsOpen,
    upcomingReservations,
    pendingReservations,
    nextPeriod,
    readiness,
    nextAction,
  };
}

function deriveReadiness(input: {
  totalTables: number;
  counts: Record<TableCapacityState, number>;
  pendingReservations: number;
  nextPeriod: ServicePeriod | null;
  now: Date;
}): ServicePeriodReadiness {
  const { totalTables, counts, pendingReservations, nextPeriod, now } = input;
  if (!nextPeriod) return "closed";
  // No usable inventory at all — the owner cannot open the period.
  if (totalTables === 0 || totalTables === counts.blocked) return "not-ready";
  // Anything demanding owner action before the period is confidently open.
  if (pendingReservations > 0 || counts.blocked > 0) return "attention";
  // If the period has already started and every table is occupied, flag it.
  const started = now.getTime() >= nextPeriod.startsAt.getTime();
  if (started && counts.available === 0 && counts["turning-soon"] === 0) return "attention";
  return "ready";
}

function deriveNextAction(input: {
  counts: Record<TableCapacityState, number>;
  waitlistParties: number;
  pendingReservations: number;
  totalTables: number;
  ownerBasePath: string;
}): { label: string; href: string } | null {
  const { counts, waitlistParties, pendingReservations, totalTables, ownerBasePath } = input;
  if (totalTables === 0) {
    return { label: "Add your tables to open bookings", href: `${ownerBasePath}/tables` };
  }
  if (pendingReservations > 0) {
    return {
      label: `Confirm ${pendingReservations} reservation${pendingReservations === 1 ? "" : "s"}`,
      href: `${ownerBasePath}/inbox`,
    };
  }
  if (waitlistParties > 0) {
    return {
      label: `Seat ${waitlistParties} waiting part${waitlistParties === 1 ? "y" : "ies"}`,
      href: `${ownerBasePath}/tables`,
    };
  }
  if (counts.blocked > 0) {
    return {
      label: `Review ${counts.blocked} blocked table${counts.blocked === 1 ? "" : "s"}`,
      href: `${ownerBasePath}/tables`,
    };
  }
  return null;
}

/**
 * A short human summary answering "are we ready for the next service period?".
 * Plain language (FK ≤ 9), used by the readiness banner and the workspace quest.
 */
export function readinessHeadline(snapshot: RestaurantCapacitySnapshot): string {
  const period = snapshot.nextPeriod?.label ?? "service";
  switch (snapshot.readiness) {
    case "ready":
      return `Ready for ${period} — ${snapshot.counts.available} of ${snapshot.totalTables} tables open`;
    case "attention":
      return snapshot.pendingReservations > 0
        ? `${period}: ${snapshot.pendingReservations} reservation${snapshot.pendingReservations === 1 ? "" : "s"} need${snapshot.pendingReservations === 1 ? "s" : ""} confirming`
        : `${period}: check tables before you open`;
    case "not-ready":
      return snapshot.totalTables === 0
        ? "No tables set up yet — add tables to take bookings"
        : `Not ready for ${period} — every table is blocked`;
    case "closed":
      return "No service period scheduled right now";
  }
}
