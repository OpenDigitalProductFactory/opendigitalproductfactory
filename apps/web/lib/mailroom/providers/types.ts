// Mailbox provider adapter contract (design 2026-09-09 §4.4, BI-13919D7E).
//
// One contract, several providers. The Mailroom's intake, triage and dispatch
// never see a provider: they see `NormalizedInboundMail`. A provider is added by
// implementing this contract and registering it in `registry.ts`, whose type is
// keyed on the Prisma enum so an unregistered provider fails the build.
//
// Attachment BYTES are not fetched in this slice — only name, type and size —
// so a poll's cost is bounded by message text, and nothing untrusted is
// written to disk.

import type { MailboxProviderKey } from "@dpf/db/mailroom-enums";

import { getErrorMessage } from "@/lib/shared/get-error-message";
import type { ActionResult } from "@/lib/shared/action-result";

/** Non-secret connection facts, stored on `MailboxAccount.settings`. */
export type ImapMailboxSettings = {
  host: string;
  port: number;
  /** Implicit TLS (port 993). When false the adapter requires STARTTLS. */
  secure: boolean;
  user: string;
  /** Folder to read; defaults to INBOX. */
  folder?: string;
};

export type Microsoft365MailboxSettings = {
  tenantId: string;
  clientId: string;
  mailboxUserPrincipalName: string;
};

/** Postmark inbound streams arrive by webhook; nothing to poll. */
export type PostmarkInboundMailboxSettings = {
  /** The inbound stream address Postmark forwards to this install. */
  inboundAddress: string;
};

export type MailboxSettingsByProvider = {
  imap: ImapMailboxSettings;
  microsoft365: Microsoft365MailboxSettings;
  "postmark-inbound": PostmarkInboundMailboxSettings;
};

/** Secrets, decrypted only for the duration of a probe or a fetch. */
export type MailboxSecretsByProvider = {
  imap: { password: string };
  microsoft365: { clientSecret: string };
  "postmark-inbound": Record<string, never>;
};

/** Where the last poll stopped. Provider-specific; opaque to the intake. */
export type MailboxCursorByProvider = {
  imap: { uidValidity: string; lastUid: number } | null;
  microsoft365: { deltaLink: string } | null;
  "postmark-inbound": null;
};

export type MailAddress = { address: string; name: string | null };

export type MailAttachmentMeta = {
  filename: string | null;
  contentType: string | null;
  size: number | null;
};

/** The header subset the triage rules read. Lower-cased names. */
export type MailHeaderSubset = {
  "auto-submitted"?: string;
  "list-id"?: string;
  "list-unsubscribe"?: string;
  precedence?: string;
  "x-auto-response-suppress"?: string;
  "content-type"?: string;
};

/** Provider-neutral inbound message. */
export type NormalizedInboundMail = {
  /** Stable provider identity for idempotency (IMAP UID, Graph message id). */
  providerMessageId: string;
  /** RFC 5322 Message-ID header, when present, for threading. */
  messageIdHeader: string | null;
  inReplyTo: string | null;
  references: string[];
  from: MailAddress | null;
  to: MailAddress[];
  subject: string | null;
  textBody: string;
  htmlBody: string | null;
  receivedAt: Date;
  headers: MailHeaderSubset;
  attachments: MailAttachmentMeta[];
};

/** Probe outcome, in the shared ActionResult shape. */
export type MailboxProbeResult = ActionResult<{ mailboxLabel: string }>;

export type MailboxFetchResult<P extends MailboxProviderKey> = {
  messages: NormalizedInboundMail[];
  cursor: MailboxCursorByProvider[P];
};

export interface MailboxProviderAdapter<P extends MailboxProviderKey = MailboxProviderKey> {
  readonly provider: P;
  /** True when the provider pushes by webhook and the poller should skip it. */
  readonly pollable: boolean;
  /** Verify the connection facts and secrets without reading mail. */
  probe(settings: MailboxSettingsByProvider[P], secrets: MailboxSecretsByProvider[P]): Promise<MailboxProbeResult>;
  /** Read messages after the cursor. `limit` bounds one poll. */
  fetchNew(
    settings: MailboxSettingsByProvider[P],
    secrets: MailboxSecretsByProvider[P],
    cursor: MailboxCursorByProvider[P],
    options?: { limit?: number },
  ): Promise<MailboxFetchResult<P>>;
}

/** Safe, operator-readable error text; never echoes credentials. */
export function safeProviderError(error: unknown): string {
  const raw = getErrorMessage(error);
  return raw.replace(/(pass(word)?|secret|token)\s*[:=]\s*\S+/gi, "$1: [redacted]").slice(0, 300);
}
