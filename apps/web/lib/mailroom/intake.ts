// Mailroom intake (design 2026-09-09 §4.4, BI-9C362E23).
//
// `pollMailbox` reads one mailbox after its cursor through the provider
// adapter, persists each message once (the unique (channelId, externalMessageId)
// index is the idempotency fact), runs triage + dispatch for the new ones, and
// advances the cursor and poll bookkeeping. A provider failure marks THAT
// mailbox `error` and returns; the caller keeps polling the others.
//
// `ingestNormalizedMail` is the provider-neutral seam the poll and the Postmark
// webhook branch both call. Everything is injected so the loop is unit-tested
// without a server, a model, or a database.

import type { MailroomProfile } from "@dpf/storefront-templates";
import type { MailboxProviderKey } from "@dpf/db/mailroom-enums";

import { dispatchMailroomItem, type DispatchDb, type DispatchTarget, type KnownSenderIngress, type NotifyPort } from "./dispatch";
import type { MailboxProviderAdapters } from "./providers/registry";
import type { MailboxCursorByProvider, MailboxSecretsByProvider, MailboxSettingsByProvider, NormalizedInboundMail } from "./providers/types";
import { safeProviderError } from "./providers/types";
import { triageInboundMail, type ClassifierPort, type SubjectLookupPort, type TriageResult } from "./triage";

export const MAILROOM_DOMAIN = "mailroom";

export function mailroomChannelId(provider: MailboxProviderKey): string {
  return `mailroom-${provider}`;
}

export type MailboxRecord = {
  id: string;
  mailboxId: string;
  organizationId: string;
  address: string;
  provider: MailboxProviderKey;
  settings: unknown;
  cursor: unknown;
  pollIntervalMinutes: number;
};

export type IntakeDb = DispatchDb & {
  inboundChannelMessage: {
    findFirst(args: unknown): Promise<{ inboundId: string } | null>;
    create(args: unknown): Promise<{ inboundId: string }>;
    update(args: unknown): Promise<unknown>;
  };
  mailboxAccount: {
    update(args: unknown): Promise<unknown>;
  };
};

export type IngestOutcome = {
  inboundId: string;
  created: boolean;
  triage: TriageResult | null;
  target: DispatchTarget | null;
};

export type IntakeDeps = {
  db: IntakeDb;
  profile: MailroomProfile;
  adapters: MailboxProviderAdapters;
  readSecrets: <P extends MailboxProviderKey>(mailbox: MailboxRecord) => MailboxSecretsByProvider[P];
  classify?: ClassifierPort;
  lookupSubject?: SubjectLookupPort;
  knownSenderIngress?: KnownSenderIngress;
  notify?: NotifyPort;
  portalOrigin?: string;
  now?: () => Date;
};

function statusFor(triage: TriageResult, target: DispatchTarget | null): "noise" | "routed" | "quarantined" {
  if (triage.noise) return "noise";
  if (!target || target.kind === "none") return "quarantined";
  return "routed";
}

/** Persist, triage and dispatch one provider-neutral message. Idempotent per (channelId, providerMessageId). */
export async function ingestNormalizedMail(deps: IntakeDeps, mailbox: MailboxRecord, mail: NormalizedInboundMail): Promise<IngestOutcome> {
  const channelId = mailroomChannelId(mailbox.provider);
  const existing = await deps.db.inboundChannelMessage.findFirst({
    where: { channelId, externalMessageId: mail.providerMessageId },
    select: { inboundId: true },
  });
  if (existing) return { inboundId: existing.inboundId, created: false, triage: null, target: null };

  const created = await deps.db.inboundChannelMessage.create({
    data: {
      organizationId: mailbox.organizationId,
      domain: MAILROOM_DOMAIN,
      channelId,
      mailboxAccountId: mailbox.id,
      externalThreadId: mail.inReplyTo ?? mail.references[0] ?? mail.messageIdHeader ?? mail.providerMessageId,
      externalMessageId: mail.providerMessageId,
      fromAddress: mail.from?.address ?? null,
      fromDisplayName: mail.from?.name ?? null,
      toAddress: mail.to[0]?.address ?? mailbox.address,
      subject: mail.subject,
      body: mail.textBody,
      receivedAt: mail.receivedAt,
      mailroomStatus: "received",
      metadata: {
        messageIdHeader: mail.messageIdHeader,
        inReplyTo: mail.inReplyTo,
        references: mail.references,
        htmlBody: mail.htmlBody,
        attachments: mail.attachments,
        headers: mail.headers,
      },
    },
    select: { inboundId: true },
  });

  const triage = await triageInboundMail({ profile: deps.profile, mail, classify: deps.classify, lookupSubject: deps.lookupSubject });
  const { target, acknowledgeBy } = await dispatchMailroomItem({
    db: deps.db,
    profile: deps.profile,
    item: { inboundId: created.inboundId, channelId, providerAccountId: mailbox.address, receivedAt: mail.receivedAt },
    mail,
    triage,
    knownSenderIngress: deps.knownSenderIngress,
    notify: deps.notify,
    portalOrigin: deps.portalOrigin,
  });

  await deps.db.inboundChannelMessage.update({
    where: { inboundId: created.inboundId },
    data: {
      mailroomStatus: statusFor(triage, target),
      reasonKey: triage.reasonKey,
      urgency: triage.urgency,
      queueKey: triage.noise ? null : triage.queueKey,
      subjectRef: triage.subjectRef,
      triageSummary: triage.summary,
      triageFlagged: triage.flagged,
      routedWorkItemId: target && target.kind !== "none" ? target.workItemId : null,
      acknowledgeBy,
    },
  });

  return { inboundId: created.inboundId, created: true, triage, target };
}

export type PollOutcome =
  | { mailboxId: string; ok: true; fetched: number; ingested: number; skipped: number }
  | { mailboxId: string; ok: false; error: string };

/** Read one mailbox after its cursor and run the loop for each new message. */
export async function pollMailbox(deps: IntakeDeps, mailbox: MailboxRecord, options?: { limit?: number }): Promise<PollOutcome> {
  const now = deps.now ?? (() => new Date());
  const adapter = deps.adapters[mailbox.provider];
  if (!adapter.pollable) {
    return { mailboxId: mailbox.mailboxId, ok: true, fetched: 0, ingested: 0, skipped: 0 };
  }
  const startedAt = now();
  try {
    const result = await (adapter as { fetchNew: (s: unknown, x: unknown, c: unknown, o?: { limit?: number }) => Promise<{ messages: NormalizedInboundMail[]; cursor: unknown }> }).fetchNew(
      mailbox.settings as MailboxSettingsByProvider[typeof mailbox.provider],
      deps.readSecrets(mailbox),
      (mailbox.cursor ?? null) as MailboxCursorByProvider[typeof mailbox.provider],
      options,
    );
    let ingested = 0;
    let skipped = 0;
    let lastMessageAt: Date | null = null;
    for (const mail of result.messages) {
      const outcome = await ingestNormalizedMail(deps, mailbox, mail);
      if (outcome.created) ingested += 1;
      else skipped += 1;
      if (!lastMessageAt || mail.receivedAt > lastMessageAt) lastMessageAt = mail.receivedAt;
    }
    const finishedAt = now();
    await deps.db.mailboxAccount.update({
      where: { id: mailbox.id },
      data: {
        cursor: result.cursor ?? undefined,
        status: "connected",
        lastPolledAt: finishedAt,
        nextPollAt: new Date(finishedAt.getTime() + mailbox.pollIntervalMinutes * 60_000),
        lastPollStatus: "ok",
        lastError: null,
        ...(lastMessageAt ? { lastMessageAt } : {}),
      },
    });
    return { mailboxId: mailbox.mailboxId, ok: true, fetched: result.messages.length, ingested, skipped };
  } catch (error) {
    const message = safeProviderError(error);
    await deps.db.mailboxAccount.update({
      where: { id: mailbox.id },
      data: {
        status: "error",
        lastPolledAt: startedAt,
        // Back off one interval so a dead server is not hammered every sweep.
        nextPollAt: new Date(startedAt.getTime() + mailbox.pollIntervalMinutes * 60_000),
        lastPollStatus: "error",
        lastError: message,
      },
    });
    return { mailboxId: mailbox.mailboxId, ok: false, error: message };
  }
}

/** Poll every due mailbox; one failure never stops the rest. */
export async function pollDueMailboxes(deps: IntakeDeps, mailboxes: MailboxRecord[]): Promise<PollOutcome[]> {
  const outcomes: PollOutcome[] = [];
  for (const mailbox of mailboxes) {
    outcomes.push(await pollMailbox(deps, mailbox));
  }
  return outcomes;
}
