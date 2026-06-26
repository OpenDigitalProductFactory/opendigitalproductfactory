// The Attention Surface notification spine (EP-ATTENTION-SURFACE, BI-094A124F).
// Spec: docs/superpowers/specs/2026-06-23-human-attention-surface-design.md §4.2.
//
// One canonical way to say "a NEW pending-human item appeared" — write a single
// deduped `Notification` row (the inbox bell/feed + badge signal) AND emit a
// realtime event (so the inbox refreshes live over the existing SSE stream).
// Today every producer hand-rolls its own Notification shape, and most don't
// notify at all (taskrun-recovery + tax only); this replaces that scatter.
//
// Pure core — deps are injected so the dedup + emit logic is unit-tested without
// a database. Best-effort BY CONTRACT: callers wrap in try/catch so a notify
// failure can never break the producer path it hooks into.

import type { AttentionSource } from "./types";

/** The realtime event broadcast when a new pending-human item appears. Generalizes
 *  the mobile-companion spec's `HitlNotificationEvent` across all attention sources
 *  (not just TaskRun). Consumed by the SSE stream for live inbox refresh. */
export type HitlAttentionEvent = {
  eventType: "attention.created";
  source: AttentionSource;
  /** Stable per source row — PIR-…, DI-…, TR-…, AP-…, BILL-…, etc. */
  itemKey: string;
  /** Recipient principal. */
  userId: string;
  title: string;
  deepLink: string;
  riskClass?: string;
  occurredAtIso: string;
};

export type NotifyAttentionInput = {
  source: AttentionSource;
  itemKey: string;
  userId: string;
  title: string;
  body?: string;
  deepLink: string;
  riskClass?: string;
};

export type NotifyAttentionDeps = {
  /** True iff an unread attention Notification of this exact type already exists
   *  for the user — the dedup probe (no dedup column on Notification, so the
   *  `type` carries the key; see attentionNotificationType). */
  hasUnread: (userId: string, type: string) => Promise<boolean>;
  createNotification: (data: {
    userId: string;
    type: string;
    title: string;
    body: string | null;
    deepLink: string;
  }) => Promise<void>;
  /** Broadcast the realtime event. Optional so the core works without a bus. */
  emit?: (event: HitlAttentionEvent) => void;
  nowIso: () => string;
};

const TYPE_PREFIX = "attention";

/** The `Notification.type` that encodes source + item. Doubles as the dedup key
 *  (migration-free — no dedup column on the model). The inbox feed filters on the
 *  `attention:` prefix to separate these from other notification kinds. */
export function attentionNotificationType(source: AttentionSource, itemKey: string): string {
  return `${TYPE_PREFIX}:${source}:${itemKey}`;
}

/** Whether a `Notification.type` is an attention-spine notification. */
export function isAttentionNotificationType(type: string): boolean {
  return type.startsWith(`${TYPE_PREFIX}:`);
}

/**
 * Notify a human that a NEW pending-human item appeared. Idempotent per
 * (userId, source, itemKey): if an unread notification already exists it no-ops,
 * so re-entry or a re-render never spams the bell. Returns whether it created one.
 */
export async function notifyAttention(
  deps: NotifyAttentionDeps,
  input: NotifyAttentionInput,
): Promise<{ created: boolean }> {
  const type = attentionNotificationType(input.source, input.itemKey);
  if (await deps.hasUnread(input.userId, type)) return { created: false };

  await deps.createNotification({
    userId: input.userId,
    type,
    title: input.title,
    body: input.body ?? null,
    deepLink: input.deepLink,
  });

  deps.emit?.({
    eventType: "attention.created",
    source: input.source,
    itemKey: input.itemKey,
    userId: input.userId,
    title: input.title,
    deepLink: input.deepLink,
    riskClass: input.riskClass,
    occurredAtIso: deps.nowIso(),
  });

  return { created: true };
}
