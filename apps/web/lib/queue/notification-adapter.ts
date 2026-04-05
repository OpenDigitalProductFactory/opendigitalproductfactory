import { prisma } from "@dpf/db";

export interface QueueNotification {
  recipientUserId: string;
  workItemId: string;
  title: string;
  body: string;
  urgency: string;
  deepLink?: string;
}

export interface NotificationAdapter {
  channel: string;
  send(notification: QueueNotification): Promise<void>;
}

// Built-in in-app adapter — writes to existing Notification model
export const inAppAdapter: NotificationAdapter = {
  channel: "in-app",
  async send(notification) {
    await prisma.notification.create({
      data: {
        userId: notification.recipientUserId,
        type: "work-queue",
        title: notification.title,
        body: notification.body,
        deepLink: notification.deepLink ?? "/workspace/my-queue",
        read: false,
      },
    });
  },
};

// Registry of active adapters — pluggable, new channels added here
const adapters: NotificationAdapter[] = [inAppAdapter];

export function registerAdapter(adapter: NotificationAdapter): void {
  adapters.push(adapter);
}

export async function sendQueueNotification(notification: QueueNotification): Promise<void> {
  await Promise.allSettled(adapters.map((a) => a.send(notification)));
}
