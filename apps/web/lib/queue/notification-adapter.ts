import type { CommunicationAdapter, CommunicationUrgency } from "@/lib/communications/channel-types";
import { createCommunicationDispatcher } from "@/lib/communications/dispatcher";
import { createInAppAdapter } from "@/lib/communications/in-app-adapter";
import {
  createExpoPushAdapter,
  isPushEnabled,
} from "@/lib/communications/expo-push-adapter";

export interface QueueNotification {
  recipientUserId: string;
  workItemId: string;
  title: string;
  body: string;
  urgency: string;
  deepLink?: string;
}

// Push is added only when the owner has enabled it (Expo project configured).
const adapters: CommunicationAdapter[] = [
  createInAppAdapter(),
  ...(isPushEnabled() ? [createExpoPushAdapter()] : []),
];

export function registerAdapter(adapter: CommunicationAdapter): void {
  adapters.push(adapter);
}

export async function sendQueueNotification(notification: QueueNotification): Promise<void> {
  const dispatcher = createCommunicationDispatcher(adapters);
  const payload = {
    target: {
      targetType: "work-item" as const,
      targetId: notification.workItemId,
      recipientUserId: notification.recipientUserId,
    },
    title: notification.title,
    body: notification.body,
    urgency: normalizeUrgency(notification.urgency),
    deepLink: notification.deepLink,
  };

  await dispatcher.send({ channel: "in-app", ...payload });

  // Best-effort push fan-out alongside the in-app notification, when registered.
  if (adapters.some((a) => a.channel === "push")) {
    await dispatcher.send({ channel: "push", ...payload });
  }
}

function normalizeUrgency(urgency: string): CommunicationUrgency {
  return urgency === "emergency"
    ? "emergency"
    : urgency === "urgent"
      ? "urgent"
      : urgency === "priority"
        ? "priority"
        : "routine";
}
