import type { CommunicationAdapter, CommunicationUrgency } from "@/lib/communications/channel-types";
import { createCommunicationDispatcher } from "@/lib/communications/dispatcher";
import { createInAppAdapter } from "@/lib/communications/in-app-adapter";

export interface QueueNotification {
  recipientUserId: string;
  workItemId: string;
  title: string;
  body: string;
  urgency: string;
  deepLink?: string;
}

const adapters: CommunicationAdapter[] = [createInAppAdapter()];

export function registerAdapter(adapter: CommunicationAdapter): void {
  adapters.push(adapter);
}

export async function sendQueueNotification(notification: QueueNotification): Promise<void> {
  const dispatcher = createCommunicationDispatcher(adapters);
  await dispatcher.send({
    channel: "in-app",
    target: {
      targetType: "work-item",
      targetId: notification.workItemId,
      recipientUserId: notification.recipientUserId,
    },
    title: notification.title,
    body: notification.body,
    urgency: normalizeUrgency(notification.urgency),
    deepLink: notification.deepLink,
  });
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
