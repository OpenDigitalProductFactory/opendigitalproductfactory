import { prisma } from "@dpf/db";
import { recordQueueTransition } from "@/lib/queue/queue-telemetry";
import type { WorkItemUrgency } from "@/lib/queue/queue-types";
import { FIELD_DISPATCH_SOURCE_TYPE, type FieldDispatchJobStatus } from "@dpf/validators";

/**
 * EP-3516E23D field-service dispatch — bridge a confirmed, provider-assigned
 * StorefrontBooking into a WorkItem on that storefront's dispatch queue, and
 * record its arrival into the shared queue flow-telemetry. This is what puts a
 * dispatched job on the dispatch board and makes field-service work measurable
 * alongside every other queue.
 *
 * Idempotent: a booking already bridged to a live WorkItem returns that item
 * rather than duplicating — safe to call on every confirm.  Best-effort at the
 * call site (a confirm must never fail because dispatch bridging did).
 */

/**
 * Statuses that mean a WorkItem is still live (not a candidate for a fresh
 * bridge). Keep legacy generic states for idempotency over existing rows, but
 * new field-dispatch jobs write the canonical lifecycle below.
 */
const LIVE_WORK_ITEM_STATUSES = [
  "queued",
  "assigned",
  "in-progress",
  "awaiting-input",
  "awaiting-approval",
  "escalated",
  "deferred",
  "quoted",
  "scheduled",
  "confirmed",
  "en-route",
  "on-site",
  "complete",
  "invoiced",
];

const INITIAL_DISPATCH_STATUS: FieldDispatchJobStatus = "confirmed";

/** Stable per-storefront dispatch queue id — one crew board per storefront. */
export function dispatchQueueId(storefrontId: string): string {
  return `dispatch-${storefrontId}`;
}

function windowLabel(scheduledAt: Date, durationMinutes: number): string {
  const end = new Date(scheduledAt.getTime() + durationMinutes * 60_000);
  const day = scheduledAt.toISOString().slice(0, 10);
  const hhmm = (d: Date) => d.toISOString().slice(11, 16);
  return `${day} ${hhmm(scheduledAt)}–${hhmm(end)} UTC`;
}

export async function bridgeBookingToWorkItem(
  bookingId: string,
  urgency: WorkItemUrgency = "routine",
): Promise<string | null> {
  const booking = await prisma.storefrontBooking.findUnique({
    where: { id: bookingId },
    include: { provider: true },
  });
  // Only confirmed, provider-assigned bookings are dispatchable jobs.
  if (!booking || booking.status !== "confirmed" || !booking.providerId) return null;

  const existing = await prisma.workItem.findFirst({
    where: {
      sourceType: FIELD_DISPATCH_SOURCE_TYPE,
      sourceId: booking.id,
      status: { in: LIVE_WORK_ITEM_STATUSES },
    },
    select: { itemId: true },
  });
  if (existing) return existing.itemId;

  const service = await prisma.storefrontItem.findUnique({
    where: { id: booking.itemId },
    select: { name: true },
  });
  const serviceName = service?.name ?? "Service";

  const queueId = dispatchQueueId(booking.storefrontId);
  const dispatchQueue = await prisma.workQueue.upsert({
    where: { queueId },
    create: {
      queueId,
      name: "Dispatch",
      queueType: "team",
      routingPolicy: {
        mode: "manual",
        considerAvailability: true,
        considerPerformance: false,
        maxConcurrentPerWorker: 5,
      },
    },
    update: {},
  });

  const providerName = booking.provider?.name ?? "unassigned";
  const workItem = await prisma.workItem.create({
    data: {
      sourceType: FIELD_DISPATCH_SOURCE_TYPE,
      sourceId: booking.id,
      title: `${serviceName} — ${booking.customerName} (${booking.bookingRef})`,
      description:
        `${serviceName} for ${booking.customerName}. ` +
        `Scheduled ${windowLabel(booking.scheduledAt, booking.durationMinutes)}. ` +
        `Assigned to ${providerName}.` +
        (booking.notes ? ` Notes: ${booking.notes}` : ""),
      urgency,
      effortClass: "physical",
      workerConstraint: { workerType: "human" },
      queueId: dispatchQueue.id,
      status: INITIAL_DISPATCH_STATUS,
      dueAt: booking.scheduledAt,
    },
  });

  void recordQueueTransition({
    queueKey: `cwq:${dispatchQueue.id}`,
    itemKind: "work-item",
    itemId: workItem.itemId,
    transition: "enqueued",
    occurredAt: workItem.createdAt,
  });

  return workItem.itemId;
}
