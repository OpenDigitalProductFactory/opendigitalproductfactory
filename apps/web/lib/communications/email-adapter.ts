// Email adapter for the communication dispatcher (BI-C7D25599).
//
// `email` has been a declared channel in COMMUNICATION_CHANNELS since the dispatcher
// shipped, with no adapter registered — so every email dispatch failed with
// `adapter_not_registered`. This registers one against the Postmark client that already
// exists at lib/marketing/channels/email-postmark/client.ts rather than adding a second
// mail path.
//
// `interactive: false` is the machine-readable form of the P1 decision (kernel
// DI-EFEB6002A5C5): this adapter cannot carry an action. A future action-bearing channel
// must flip that flag deliberately, and the per-class security review the BI calls Open
// Decision 3 is the gate for doing so.

import { sendEmail, type FetchImpl } from "@/lib/marketing/channels/email-postmark/client";

import type {
  CommunicationAdapter,
  CommunicationDeliveryResult,
  SendCommunicationInput,
} from "./channel-types";

export type EmailAdapterConfig = {
  /** Postmark server token. */
  serverToken: string;
  /** Verified sender address. */
  from: string;
  /** Where a reply goes, when the install wants replies to land somewhere real. */
  replyTo?: string;
  /** Test seam. */
  fetchImpl?: FetchImpl;
};

/** Resolve config from the environment. Returns null when email is not configured — an
 *  unconfigured channel must be an honest "not available", never a silent success. */
export function resolveEmailAdapterConfig(
  env: NodeJS.ProcessEnv = process.env,
): EmailAdapterConfig | null {
  const serverToken = env.POSTMARK_SERVER_TOKEN?.trim();
  const from = env.POSTMARK_FROM_EMAIL?.trim() ?? env.DPF_NOTIFICATION_FROM_EMAIL?.trim();
  if (!serverToken || !from) return null;
  return {
    serverToken,
    from,
    ...(env.DPF_NOTIFICATION_REPLY_TO?.trim()
      ? { replyTo: env.DPF_NOTIFICATION_REPLY_TO.trim() }
      : {}),
  };
}

export function createEmailAdapter(config: EmailAdapterConfig): CommunicationAdapter {
  return {
    key: "postmark-email",
    channel: "email",
    capabilities: {
      outbound: true,
      // Inbound parsing exists in the Postmark client, but no decision path consumes it
      // yet — claiming the capability would be a lie the dispatcher would act on.
      inbound: false,
      // See the module comment. This is a contract, not a stub.
      interactive: false,
      deliveryReceipts: false,
      readReceipts: false,
      templatesRequired: false,
    },
    async send(input: SendCommunicationInput): Promise<CommunicationDeliveryResult> {
      const to = recipientAddress(input);
      if (!to) {
        return {
          channel: "email",
          status: "failed",
          errorCode: "no_recipient_address",
          errorMessage: "No email address is bound for this recipient.",
        };
      }

      const result = await sendEmail(
        config.serverToken,
        {
          from: config.from,
          to,
          subject: input.title,
          textBody: input.body,
          ...(config.replyTo ? { replyTo: config.replyTo } : {}),
          tag: "attention-reach",
        },
        config.fetchImpl,
      );

      if (result.ok) {
        return { channel: "email", status: "sent", providerMessageId: result.messageId };
      }
      return {
        channel: "email",
        status: "failed",
        errorCode: result.error,
        errorMessage: `Postmark rejected the send (status ${result.status}).`,
      };
    },
  };
}

/** The recipient address travels in metadata; the dispatcher's target carries ids, not
 *  contact details. Kept narrow so a malformed value fails closed rather than sending
 *  someone else's decision to an arbitrary address. */
function recipientAddress(input: SendCommunicationInput): string | null {
  const raw = input.metadata?.emailAddress;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  // Deliberately minimal validation: enough to reject obvious junk and anything carrying a
  // header separator, without pretending to fully validate an address.
  if (trimmed.length === 0 || /[\s,;<>\r\n]/.test(trimmed)) return null;
  if (!/^[^@]+@[^@]+\.[^@]+$/.test(trimmed)) return null;
  return trimmed;
}
