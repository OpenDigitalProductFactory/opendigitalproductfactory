// Production binding of the attention notification spine (BI-094A124F).
// Wires the pure notifyAttention core (notify.ts) to prisma (the Notification
// row) and the agent-event-bus (realtime SSE refresh), and resolves the operator
// recipient. Server-only. Every entry point is BEST-EFFORT — it never throws, so
// a notification failure can never break the producer path it hooks into.

import { prisma } from "@dpf/db";
import { agentEventBus } from "@/lib/tak/agent-event-bus";
import { resolveScheduledOwnerUserId } from "@/lib/queue/scheduled-owner";
import { notifyAttention, type NotifyAttentionDeps, type NotifyAttentionInput } from "./notify";

const liveDeps: NotifyAttentionDeps = {
  hasUnread: async (userId, type) =>
    (await prisma.notification.findFirst({
      where: { userId, type, read: false },
      select: { id: true },
    })) != null,
  createNotification: async (data) => {
    await prisma.notification.create({ data });
  },
  emit: (event) => {
    agentEventBus.broadcastSystem({
      type: "attention:created",
      source: event.source,
      itemKey: event.itemKey,
      userId: event.userId,
      title: event.title,
      deepLink: event.deepLink,
      riskClass: event.riskClass,
    });
  },
  nowIso: () => new Date().toISOString(),
};

/**
 * Production notify — fire-and-forget from a producer path. Best-effort: any
 * failure (DB, bus, resolver) is swallowed so the producer it hooks never breaks.
 */
export async function notifyAttentionLive(input: NotifyAttentionInput): Promise<void> {
  try {
    await notifyAttention(liveDeps, input);
  } catch {
    // Best-effort by contract — the producer path must not fail on a notify error.
  }
}

/**
 * The recipient for operator-facing attention items (escalations, AI-decision
 * residue, agent proposals): the bootstrap install owner. Paused-AI items use the
 * owning `TaskRun.userId` directly instead. Returns null if no owner resolves, in
 * which case the caller skips the notification (still best-effort).
 */
export async function resolveOperatorRecipient(): Promise<string | null> {
  try {
    return await resolveScheduledOwnerUserId();
  } catch {
    return null;
  }
}
