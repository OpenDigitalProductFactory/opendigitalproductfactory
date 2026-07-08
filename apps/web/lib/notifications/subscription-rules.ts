// User-configurable notification / subscription rules — BI-997503EC
// (EP-CLAUDE-INSIDE-OUT). "Notify me when a record in category X matching filter
// Y changes." A rule is a durable NotificationSubscription owned by a user; when
// an event is dispatched, active immediate rules whose equality filter matches
// the event attributes produce a Notification row for the owner.
//
// The matcher is PURE (testable without a DB). The IO layer is CRUD +
// dispatchEventToSubscribers, which reuses the existing Notification model. Slice
// 1 makes the primitive callable; wiring concrete record-change event sources
// (backlog status, ticket updates, build phase) is Slice 2 (follow-up BI).

import { prisma } from "@dpf/db";

/** Closed cadence vocabulary. `digest` batching is Slice 2 — only `immediate` fires today. */
export const SUBSCRIPTION_CADENCES = ["immediate", "digest"] as const;
export type SubscriptionCadence = (typeof SUBSCRIPTION_CADENCES)[number];

export type SubscriptionFilter = Record<string, string | number | boolean> | null | undefined;

/** A record-change event a subscription can match against. */
export type SubscriptionEvent = {
  eventCategory: string;
  /** Flat attributes matched by equality against a rule's filter. */
  attributes: Record<string, string | number | boolean>;
  /** Notification payload used when a rule matches. */
  title: string;
  body?: string | null;
  deepLink?: string | null;
};

/**
 * Pure: does an event satisfy a subscription's filter? A null/empty filter
 * matches every event in the category (subscribe-to-all). Otherwise EVERY filter
 * key must be present in the event attributes AND equal (strict, primitive
 * equality). A filter key the event lacks is a non-match — a rule never fires on
 * an attribute that was not reported.
 */
export function matchesSubscriptionFilter(filter: SubscriptionFilter, attributes: Record<string, unknown>): boolean {
  if (!filter) return true;
  const keys = Object.keys(filter);
  if (keys.length === 0) return true;
  return keys.every((k) => Object.prototype.hasOwnProperty.call(attributes, k) && attributes[k] === filter[k]);
}

export async function createSubscription(params: {
  userId: string;
  eventCategory: string;
  filter?: SubscriptionFilter;
  channel?: string;
  cadence?: SubscriptionCadence;
}): Promise<{ ok: true; subscriptionId: string } | { ok: false; error: string }> {
  const eventCategory = (params.eventCategory ?? "").trim();
  if (!eventCategory) return { ok: false, error: "eventCategory must not be empty." };
  const cadence = params.cadence ?? "immediate";
  if (!SUBSCRIPTION_CADENCES.includes(cadence)) return { ok: false, error: `Unknown cadence: ${cadence}` };
  const row = await prisma.notificationSubscription.create({
    data: {
      userId: params.userId,
      eventCategory,
      filter: (params.filter ?? undefined) as object | undefined,
      channel: params.channel ?? "in_app",
      cadence,
    },
    select: { id: true },
  });
  return { ok: true, subscriptionId: row.id };
}

export type SubscriptionRecord = {
  id: string;
  eventCategory: string;
  filter: SubscriptionFilter;
  cadence: string;
  active: boolean;
};

export async function listSubscriptions(userId: string): Promise<SubscriptionRecord[]> {
  const rows = await prisma.notificationSubscription.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { id: true, eventCategory: true, filter: true, cadence: true, active: true },
  });
  return rows.map((r) => ({ ...r, filter: r.filter as SubscriptionFilter }));
}

/** Delete a subscription, scoped to its owner so a user can only remove their own. */
export async function deleteSubscription(userId: string, subscriptionId: string): Promise<{ ok: boolean }> {
  await prisma.notificationSubscription.deleteMany({ where: { id: subscriptionId, userId } });
  return { ok: true };
}

/**
 * Dispatch an event to all matching active immediate subscriptions, creating one
 * Notification per matching owner. Returns the number of notifications created.
 * `digest`-cadence rules are intentionally skipped here (Slice 2 batches them).
 * This is the seam concrete record-change sources call in Slice 2.
 */
export async function dispatchEventToSubscribers(event: SubscriptionEvent): Promise<{ notified: number }> {
  const subs = await prisma.notificationSubscription.findMany({
    where: { eventCategory: event.eventCategory, active: true, cadence: "immediate" },
    select: { id: true, userId: true, filter: true },
  });
  const matched = subs.filter((s) => matchesSubscriptionFilter(s.filter as SubscriptionFilter, event.attributes));
  if (matched.length === 0) return { notified: 0 };

  // De-dup by user: one Notification per user even if multiple of their rules match.
  const userIds = [...new Set(matched.map((s) => s.userId))];
  await prisma.notification.createMany({
    data: userIds.map((userId) => ({
      userId,
      type: `subscription:${event.eventCategory}`,
      title: event.title,
      body: event.body ?? null,
      deepLink: event.deepLink ?? null,
    })),
  });
  return { notified: userIds.length };
}
