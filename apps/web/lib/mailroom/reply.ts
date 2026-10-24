// Mailroom reply (design 2026-09-09 §4.8, BI-DFEFAE1C).
//
// Drafting creates an OutboundDraft pending review and never sends. Sending
// happens only from an explicit approval by a person: it goes through the
// shared outbound path with In-Reply-To and References set from the original
// headers, records the reply on the item and the room, and — when no outbound
// email is configured — reports that fact and where to fix it instead of
// recording a send that did not happen (kernel: outbound actions require an
// explicit go).

import type { MailroomProfile } from "@dpf/storefront-templates";
import { mailroomReasonByKey } from "@dpf/storefront-templates";

export const MAILROOM_REPLY_SOURCE_TYPE = "inbound-channel-message";
export const MAILROOM_OUTBOUND_DOMAIN = "mailroom";

export type MailroomItemForReply = {
  inboundId: string;
  organizationId: string;
  fromAddress: string | null;
  fromDisplayName: string | null;
  subject: string | null;
  body: string;
  reasonKey: string | null;
  subjectRef: string | null;
  routedWorkItemId: string | null;
  metadata: unknown;
};

export type ReplyDb = {
  outboundDraft: {
    findFirst(args: unknown): Promise<{ draftId: string; status: string; body: string; metadata: unknown } | null>;
    create(args: unknown): Promise<{ draftId: string }>;
    update(args: unknown): Promise<unknown>;
  };
  outboundApprovalDecision: {
    create(args: unknown): Promise<unknown>;
  };
  inboundChannelMessage: {
    update(args: unknown): Promise<unknown>;
  };
  workItem: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
  };
  workItemMessage: {
    create(args: unknown): Promise<unknown>;
  };
};

/** Composes the reply text; the routed-inference implementation lives in runtime. */
export type ReplyComposerPort = (input: {
  item: MailroomItemForReply;
  reasonLabel: string | null;
  businessName: string;
  subjectFacts: string | null;
}) => Promise<string | null>;

export type SendMailPort = (options: {
  to: string;
  subject: string;
  text: string;
  html: string;
  inReplyTo?: string;
  references?: string[];
}) => Promise<{ messageId: string }>;

export function replySubject(subject: string | null): string {
  const base = (subject ?? "").trim();
  if (!base) return "Re: your message";
  return /^re:/i.test(base) ? base : `Re: ${base}`;
}

function threadHeaders(item: MailroomItemForReply): { inReplyTo: string | null; references: string[] } {
  const meta = (item.metadata ?? {}) as { messageIdHeader?: unknown; references?: unknown };
  const inReplyTo = typeof meta.messageIdHeader === "string" ? meta.messageIdHeader : null;
  const prior = Array.isArray(meta.references) ? meta.references.filter((r): r is string => typeof r === "string") : [];
  const references = inReplyTo ? [...prior, inReplyTo] : prior;
  return { inReplyTo, references };
}

/** A plain, honest holding reply used when no composer is available or it returns nothing. */
export function fallbackReplyBody(input: { item: MailroomItemForReply; reasonLabel: string | null; businessName: string }): string {
  const name = input.item.fromDisplayName?.trim().split(/\s+/)[0] ?? "";
  const greeting = name ? `Hi ${name},` : "Hello,";
  const about = input.reasonLabel ? ` about ${input.reasonLabel.toLowerCase()}` : "";
  return `${greeting}\n\nThank you for writing to ${input.businessName}${about}. We have received your message and the right person is looking at it now. We will come back to you with an answer or a clear next step.\n\nKind regards,\n${input.businessName}`;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Create the pending-review draft for an item. Idempotent per item; never sends. */
export async function draftMailroomReply(input: {
  db: ReplyDb;
  profile: MailroomProfile;
  item: MailroomItemForReply;
  businessName: string;
  subjectFacts?: string | null;
  compose?: ReplyComposerPort;
  agentId: string;
}): Promise<{ draftId: string; created: boolean; body: string }> {
  const { db, item } = input;
  const existing = await db.outboundDraft.findFirst({
    where: { sourceType: MAILROOM_REPLY_SOURCE_TYPE, sourceId: item.inboundId, status: { in: ["draft", "pending-review"] } },
    select: { draftId: true, status: true, body: true, metadata: true },
  });
  if (existing) return { draftId: existing.draftId, created: false, body: existing.body };

  const reasonLabel = item.reasonKey ? mailroomReasonByKey(input.profile, item.reasonKey)?.label ?? null : null;
  const composed = input.compose
    ? await input.compose({ item, reasonLabel, businessName: input.businessName, subjectFacts: input.subjectFacts ?? null }).catch(() => null)
    : null;
  const body = composed?.trim() || fallbackReplyBody({ item, reasonLabel, businessName: input.businessName });
  const { inReplyTo, references } = threadHeaders(item);
  const draft = await db.outboundDraft.create({
    data: {
      organizationId: item.organizationId,
      domain: MAILROOM_OUTBOUND_DOMAIN,
      sourceType: MAILROOM_REPLY_SOURCE_TYPE,
      sourceId: item.inboundId,
      status: "pending-review",
      channelId: "email",
      assetType: "reply",
      body,
      bodyFormat: "plain",
      metadata: { to: item.fromAddress, subject: replySubject(item.subject), inReplyTo, references, reasonKey: item.reasonKey, subjectRef: item.subjectRef },
      createdByAgentId: input.agentId,
    },
    select: { draftId: true },
  });
  return { draftId: draft.draftId, created: true, body };
}

export type SendApprovedReplyResult =
  | { status: "sent"; messageId: string }
  | { status: "not-configured"; settingsRoute: string }
  | { status: "no-recipient" | "draft-not-pending" | "draft-missing" };

/** Approve a pending draft and send it. The approval is the person's; the send is the platform's. */
export async function sendApprovedMailroomReply(input: {
  db: ReplyDb;
  item: MailroomItemForReply;
  draftId: string;
  reviewerUserId: string;
  editedBody?: string | null;
  isEmailConfigured: () => Promise<boolean>;
  sendMail: SendMailPort;
  now?: Date;
}): Promise<SendApprovedReplyResult> {
  const { db, item } = input;
  const draft = await db.outboundDraft.findFirst({ where: { draftId: input.draftId }, select: { draftId: true, status: true, body: true, metadata: true } });
  if (!draft) return { status: "draft-missing" };
  if (draft.status !== "pending-review" && draft.status !== "draft") return { status: "draft-not-pending" };
  if (!item.fromAddress) return { status: "no-recipient" };
  if (!(await input.isEmailConfigured())) {
    return { status: "not-configured", settingsRoute: "/admin/settings" };
  }

  const body = input.editedBody?.trim() || draft.body;
  const { inReplyTo, references } = threadHeaders(item);
  const subject = replySubject(item.subject);
  const sent = await input.sendMail({
    to: item.fromAddress,
    subject,
    text: body,
    html: `<p>${escapeHtml(body).replace(/\n/g, "<br/>")}</p>`,
    ...(inReplyTo ? { inReplyTo } : {}),
    ...(references.length ? { references } : {}),
  });
  const now = input.now ?? new Date();

  await db.outboundApprovalDecision.create({
    data: { draftId: draft.draftId, reviewerUserId: input.reviewerUserId, decision: "approved", editedBody: input.editedBody?.trim() || null, decidedAt: now },
  });
  await db.outboundDraft.update({
    where: { draftId: draft.draftId },
    data: { status: "approved", body, metadata: { ...((draft.metadata as object) ?? {}), sentMessageId: sent.messageId, sentAt: now.toISOString() } },
  });
  await db.inboundChannelMessage.update({
    where: { inboundId: item.inboundId },
    data: { mailroomStatus: "replied", repliedAt: now, draftedReplyId: draft.draftId },
  });
  if (item.routedWorkItemId) {
    const room = await db.workItem.findFirst({ where: { itemId: item.routedWorkItemId }, select: { id: true } });
    if (room) {
      await db.workItemMessage.create({
        data: {
          workItemId: room.id,
          senderType: "user",
          senderUserId: input.reviewerUserId,
          messageType: "status-update",
          body: `Replied to ${item.fromDisplayName ?? item.fromAddress}: ${subject}`,
          structuredPayload: { mailroomItemId: item.inboundId, draftId: draft.draftId, sentMessageId: sent.messageId },
          channel: "email",
        },
      });
    }
  }
  return { status: "sent", messageId: sent.messageId };
}
