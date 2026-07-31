import type {
  CapacityChipData,
  QuestData,
  QueueItemData,
  ResourceUnitData,
} from "@/components/twin";
import {
  readinessHeadline,
  type RestaurantCapacitySnapshot,
} from "@/lib/storefront/restaurant-capacity";

import { humanizeWait, monthDay } from "./operations-format";

type RestaurantResource = {
  id: string;
  label: string;
  status: string;
};

type RestaurantBooking = {
  id: string;
  createdAt?: Date | null;
  scheduledAt: Date | null;
  status: string;
  provider: { name: string } | null;
};

export function hospitalityResourceUnits(
  resources: RestaurantResource[],
  limit = 12,
): ResourceUnitData[] {
  return resources.slice(0, limit).map((resource) => ({
    key: resource.id,
    label: resource.label,
    state: resource.status === "active" ? "Available" : "Off",
    intent: resource.status === "active" ? "success" : "neutral",
  }));
}

/** Restaurant-native capacity facts for the Workspace operations view. */
export function restaurantCapacityChips(
  snapshot: RestaurantCapacitySnapshot,
): CapacityChipData[] {
  const seated =
    snapshot.counts.occupied + snapshot.counts["turning-soon"];
  const chips: CapacityChipData[] = [
    {
      key: "tables-open",
      label: "Tables open",
      value: snapshot.counts.available,
      intent: snapshot.counts.available > 0 ? "success" : "warning",
      live: true,
    },
    {
      key: "tables-seated",
      label: "Seated",
      value: seated,
      intent: "info",
      live: true,
    },
  ];
  if (snapshot.counts["turning-soon"] > 0) {
    chips.push({
      key: "turning",
      label: "Turning soon",
      value: snapshot.counts["turning-soon"],
      intent: "warning",
      live: true,
    });
  }
  chips.push(
    {
      key: "waiting",
      label: "Parties waiting",
      value: snapshot.waitlistParties,
      intent: snapshot.waitlistParties > 0 ? "warning" : "success",
      live: true,
    },
    {
      key: "reservations",
      label: "Reservations ahead",
      value: snapshot.upcomingReservations,
      intent: "accent",
      live: true,
    },
  );
  return chips;
}

/** The next service-readiness action, when the venue needs attention. */
export function readinessQuest(
  snapshot: RestaurantCapacitySnapshot,
): QuestData | null {
  if (!snapshot.nextAction) return null;
  return {
    key: "service-readiness",
    title: readinessHeadline(snapshot),
    detail: snapshot.nextAction.label,
    intent: snapshot.readiness === "not-ready" ? "danger" : "warning",
    cta: snapshot.nextAction.label,
  };
}

export function isReservationQueueKey(key: string): boolean {
  return /reserv/i.test(key);
}

export function isUpcomingReservation(
  booking: RestaurantBooking,
  now: Date,
): boolean {
  const status = booking.status.toLowerCase();
  if (status === "cancelled" || status === "completed") return false;
  return (
    booking.scheduledAt != null &&
    booking.scheduledAt.getTime() > now.getTime()
  );
}

/** Upcoming reservations ordered by the next service time. */
export function reservationsToQueueItems(
  bookings: RestaurantBooking[],
  now: Date,
  limit = 6,
): QueueItemData[] {
  return bookings
    .filter((booking) => isUpcomingReservation(booking, now))
    .sort(
      (a, b) =>
        (a.scheduledAt?.getTime() ?? Infinity) -
        (b.scheduledAt?.getTime() ?? Infinity),
    )
    .slice(0, limit)
    .map((booking) => ({
      key: booking.id,
      label: booking.provider?.name
        ? `With ${booking.provider.name}`
        : "Reservation",
      meta: booking.scheduledAt
        ? `booked for ${monthDay(booking.scheduledAt)}`
        : "awaiting schedule",
      waiting: booking.scheduledAt
        ? `in ${humanizeWait(booking.scheduledAt.getTime() - now.getTime())}`
        : undefined,
    }));
}
