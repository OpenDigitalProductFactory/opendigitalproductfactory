"use server";

// User-facing server actions for notification subscription rules — BI-997503EC.
// Each action is scoped to the authenticated user via requireUserId, so a user
// can only create, list, or remove their OWN rules. The rule logic + matcher
// live in lib/notifications/subscription-rules.ts.

import {
  createSubscription,
  deleteSubscription,
  listSubscriptions,
  type SubscriptionCadence,
  type SubscriptionFilter,
  type SubscriptionRecord,
} from "@/lib/notifications/subscription-rules";

import { requireUserId } from "./shared/guards";

export async function createNotificationRule(input: {
  eventCategory: string;
  filter?: SubscriptionFilter;
  cadence?: SubscriptionCadence;
}): Promise<{ ok: boolean; subscriptionId?: string; error?: string }> {
  const userId = await requireUserId();
  const res = await createSubscription({
    userId,
    eventCategory: input.eventCategory,
    filter: input.filter,
    cadence: input.cadence,
  });
  return res.ok ? { ok: true, subscriptionId: res.subscriptionId } : { ok: false, error: res.error };
}

export async function listNotificationRules(): Promise<SubscriptionRecord[]> {
  const userId = await requireUserId();
  return listSubscriptions(userId);
}

export async function deleteNotificationRule(subscriptionId: string): Promise<{ ok: boolean }> {
  const userId = await requireUserId();
  return deleteSubscription(userId, subscriptionId);
}
