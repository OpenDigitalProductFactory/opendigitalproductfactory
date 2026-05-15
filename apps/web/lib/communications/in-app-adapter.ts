import { prisma } from "@dpf/db";

import type { CommunicationAdapter } from "./channel-types";

export function createInAppAdapter(): CommunicationAdapter {
  return {
    key: "in-app",
    channel: "in-app",
    capabilities: {
      outbound: true,
      inbound: false,
      interactive: false,
      deliveryReceipts: false,
      readReceipts: false,
      templatesRequired: false,
    },
    async send(input) {
      if (!input.target.recipientUserId) {
        return {
          channel: "in-app",
          status: "failed",
          errorCode: "missing_recipient_user",
          errorMessage: "In-app notifications require recipientUserId.",
        };
      }

      const notification = await prisma.notification.create({
        data: {
          userId: input.target.recipientUserId,
          type: input.target.targetType === "work-item" ? "work-queue" : "communication",
          title: input.title,
          body: input.body,
          deepLink: input.deepLink ?? "/workspace/my-queue",
          read: false,
        },
      });

      return {
        channel: "in-app",
        status: "sent",
        providerMessageId: notification.id,
      };
    },
  };
}
