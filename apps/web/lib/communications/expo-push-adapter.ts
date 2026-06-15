// apps/web/lib/communications/expo-push-adapter.ts
//
// CommunicationAdapter for the "push" channel, backed by Expo. Looks up the
// recipient's registered device tokens and sends via the Expo transport.
// Registered only when push is enabled (DPF_PUSH_ENABLED=true) — inert until
// the Expo project is configured (owner setup, BI-MOBAPP-ACCOUNTS).

import type { CommunicationAdapter } from "./channel-types";
import {
  buildExpoPushMessages,
  sendExpoPush,
  type ExpoPushMessage,
  type ExpoPushResult,
} from "./expo-push";

/** Push delivery is gated until the owner configures the Expo project + creds. */
export function isPushEnabled(): boolean {
  return process.env.DPF_PUSH_ENABLED === "true";
}

export interface ExpoPushAdapterDeps {
  loadDeviceTokens: (userId: string) => Promise<string[]>;
  send: (messages: ExpoPushMessage[]) => Promise<ExpoPushResult>;
}

const defaultDeps: ExpoPushAdapterDeps = {
  loadDeviceTokens: async (userId) => {
    // Lazy import keeps this module (and its tests, which inject deps) DB-free.
    const { prisma } = await import("@dpf/db");
    const rows = await prisma.pushDeviceRegistration.findMany({
      where: { userId },
      select: { token: true },
    });
    return rows.map((r) => r.token);
  },
  send: (messages) => sendExpoPush(messages),
};

export function createExpoPushAdapter(
  deps: ExpoPushAdapterDeps = defaultDeps,
): CommunicationAdapter {
  return {
    key: "expo-push",
    channel: "push",
    capabilities: {
      outbound: true,
      inbound: false,
      interactive: false,
      deliveryReceipts: true,
      readReceipts: false,
      templatesRequired: false,
    },
    async send(input) {
      const userId = input.target.recipientUserId;
      if (!userId) {
        return {
          channel: "push",
          status: "failed",
          errorCode: "missing_recipient_user",
          errorMessage: "Push notifications require recipientUserId.",
        };
      }

      const tokens = await deps.loadDeviceTokens(userId);
      if (tokens.length === 0) {
        return {
          channel: "push",
          status: "failed",
          errorCode: "no_registered_devices",
          errorMessage: "Recipient has no registered push devices.",
        };
      }

      const messages = buildExpoPushMessages(tokens, {
        title: input.title,
        body: input.body,
        deepLink: input.deepLink,
      });
      if (messages.length === 0) {
        return {
          channel: "push",
          status: "failed",
          errorCode: "no_valid_tokens",
          errorMessage: "No valid Expo push tokens for recipient.",
        };
      }

      const result = await deps.send(messages);
      return result.ok
        ? {
            channel: "push",
            status: "sent",
            providerMessageId: result.ticketIds[0],
          }
        : {
            channel: "push",
            status: "failed",
            errorCode: "expo_send_failed",
            errorMessage: result.error,
          };
    },
  };
}
