// Mailroom closed sets — the TypeScript unions behind the Prisma enums in
// prisma/schema/mailroom.prisma (BI-1DDFC3D1). Widening one is a migration plus
// an edit here; a string literal elsewhere is a defect (AGENTS.md §8).
//
// Values are the DATABASE spellings (the `@map`'d value where one exists) so
// they can be shown, compared and stored without a second translation table.
// Prisma `where` clauses take the enum MEMBER — `postmark_inbound` — never the
// mapped value; the two `MailboxProvider*` helpers below keep that boundary.

export const MAILBOX_PROVIDERS = ["imap", "microsoft365", "postmark-inbound"] as const;
export type MailboxProviderKey = (typeof MAILBOX_PROVIDERS)[number];

/** Prisma enum member for a provider key (the `@map` boundary). */
export const MAILBOX_PROVIDER_MEMBER: Readonly<Record<MailboxProviderKey, "imap" | "microsoft365" | "postmark_inbound">> = {
  imap: "imap",
  microsoft365: "microsoft365",
  "postmark-inbound": "postmark_inbound",
};

export const MAILBOX_PROVIDER_KEY: Readonly<Record<"imap" | "microsoft365" | "postmark_inbound", MailboxProviderKey>> = {
  imap: "imap",
  microsoft365: "microsoft365",
  postmark_inbound: "postmark-inbound",
};

export const MAILBOX_STATUSES = ["pending", "connected", "error", "paused"] as const;
export type MailboxStatusKey = (typeof MAILBOX_STATUSES)[number];

export const MAILROOM_URGENCIES = ["immediate", "hours", "days", "weeks"] as const;
export type MailroomUrgencyKey = (typeof MAILROOM_URGENCIES)[number];

export const MAILROOM_ITEM_STATUSES = [
  "received",
  "noise",
  "quarantined",
  "routed",
  "acknowledged",
  "replied",
  "closed",
] as const;
export type MailroomItemStatusKey = (typeof MAILROOM_ITEM_STATUSES)[number];

/** Statuses in which an item still waits for a person. */
export const MAILROOM_OPEN_ITEM_STATUSES = ["routed"] as const satisfies readonly MailroomItemStatusKey[];
