import type { QueueItemData } from "@/components/twin";

import {
  humanizeWait,
  isWalkInWait,
  monthDay,
} from "./operations-format";

type QueueBooking = {
  id: string;
  scheduledAt: Date | null;
  createdAt: Date | null;
  status: string;
  provider: { name: string } | null;
};

/** Pending demand ordered by the longest genuine wait. */
export function bookingsToQueueItems(
  bookings: QueueBooking[],
  now: Date,
  limit = 6,
): QueueItemData[] {
  return bookings
    .filter(
      (booking) =>
        booking.status.toLowerCase() === "pending" ||
        booking.provider == null,
    )
    .sort(
      (a, b) =>
        (a.createdAt?.getTime() ?? Infinity) -
        (b.createdAt?.getTime() ?? Infinity),
    )
    .slice(0, limit)
    .map((booking) => {
      const label = booking.provider?.name
        ? `With ${booking.provider.name}`
        : "Unassigned";
      if (booking.scheduledAt && booking.scheduledAt.getTime() > now.getTime()) {
        return {
          key: booking.id,
          label,
          meta: `booked for ${monthDay(booking.scheduledAt)}`,
          waiting: `in ${humanizeWait(
            booking.scheduledAt.getTime() - now.getTime(),
          )}`,
        };
      }
      if (booking.scheduledAt) {
        return {
          key: booking.id,
          label,
          meta: `overdue · was ${monthDay(booking.scheduledAt)}`,
        };
      }
      return {
        key: booking.id,
        label,
        meta: "awaiting schedule",
        waiting: booking.createdAt
          ? humanizeWait(now.getTime() - booking.createdAt.getTime())
          : undefined,
      };
    });
}

/** The longest age among pending unscheduled walk-ins. */
export function longestWaitMs(
  bookings: QueueBooking[],
  now: Date,
): number {
  const waiting = bookings.filter(
    (booking) =>
      (booking.status.toLowerCase() === "pending" ||
        booking.provider == null) &&
      isWalkInWait(booking),
  );
  let max = 0;
  for (const booking of waiting) {
    if (booking.createdAt) {
      max = Math.max(max, now.getTime() - booking.createdAt.getTime());
    }
  }
  return max;
}
