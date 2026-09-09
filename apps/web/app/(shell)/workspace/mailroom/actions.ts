"use server";

// Mailroom server actions (design 2026-09-09 §4.9, BI-727D5FD9).
//
// Connect probes the provider before anything is saved and runs a first read on
// success; pause keeps history; remove deletes the mailbox record and unlinks
// its items; acknowledge records who and when; draft creates a pending draft;
// approve-and-send is the only path a reply leaves by.

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { prisma } from "@dpf/db";
import { MAILBOX_PROVIDER_MEMBER } from "@dpf/db/mailroom-enums";

import { parseMailboxForm, formField as field, type MailboxFormTypes } from "@/lib/mailroom/mailbox-form";

import { auth } from "@/lib/auth";
import { encryptJson } from "@/lib/govern/credential-crypto";
import { resolvePrincipalIdForUser } from "@/lib/identity/principal-linking";
import { MAILROOM_AGENT_ID } from "@/lib/mailroom/classifier";
import { createMailboxProviderAdapters } from "@/lib/mailroom/providers/registry";
import { draftMailroomReply, sendApprovedMailroomReply, type ReplyDb } from "@/lib/mailroom/reply";
import { composeMailroomReply, pollMailboxNow, resolveMailroomOrganizationId, resolveOrganizationMailroomProfile } from "@/lib/mailroom/runtime.server";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";
import { isEmailConfigured, sendEmail } from "@/lib/shared/email";

const MAILROOM_PATH = "/workspace/mailroom";

async function operatorContext() {
  const session = await auth();
  const user = session?.user as { id?: string; type?: string } | undefined;
  if (!user?.id || user.type !== "admin") return null;
  const organizationId = await resolveMailroomOrganizationId();
  if (!organizationId) return null;
  return { userId: user.id, organizationId };
}

function newMailboxId(): string {
  return `MBX-${randomBytes(4).toString("hex").toUpperCase()}`;
}

type ConnectMailboxResult = MailboxFormTypes["ConnectMailboxResult"];

/** Parse the connect form into provider settings + secrets. Exported for tests. */
export async function connectMailbox(_prev: ConnectMailboxResult | null, formData: FormData): Promise<ConnectMailboxResult> {
  const ctx = await operatorContext();
  if (!ctx) return err("You need an operator account to connect a mailbox.");
  const parsedResult = parseMailboxForm(formData);
  if (!parsedResult.ok) return err(parsedResult.error);
  const parsed = parsedResult.data;

  const profile = await resolveOrganizationMailroomProfile(ctx.organizationId);
  if (!profile.expectedMailboxes.some((m) => m.purposeKey === parsed.purposeKey)) return err("That purpose is not one this business uses.");

  const adapters = createMailboxProviderAdapters();
  const adapter = adapters[parsed.provider] as { probe: (s: unknown, x: unknown) => Promise<ActionResult<{ mailboxLabel: string }>> };
  const probe = await adapter.probe(parsed.settings, parsed.secrets);
  if (!probe.ok) return err(`Could not read that mailbox: ${probe.error}`);

  const principalId = await resolvePrincipalIdForUser(ctx.userId);
  const mailboxRef = newMailboxId();
  const hasSecrets = parsed.secrets && Object.keys(parsed.secrets as object).length > 0;
  await prisma.mailboxAccount.upsert({
    where: { organizationId_address: { organizationId: ctx.organizationId, address: parsed.address } },
    create: {
      mailboxRef,
      organizationId: ctx.organizationId,
      address: parsed.address,
      displayName: parsed.displayName,
      purposeKey: parsed.purposeKey,
      provider: MAILBOX_PROVIDER_MEMBER[parsed.provider],
      status: "connected",
      settings: parsed.settings as object,
      secretsEnc: hasSecrets ? encryptJson(parsed.secrets) : null,
      pollIntervalMinutes: parsed.pollIntervalMinutes,
      nextPollAt: new Date(),
      createdByPrincipalId: principalId,
    },
    update: {
      displayName: parsed.displayName,
      purposeKey: parsed.purposeKey,
      provider: MAILBOX_PROVIDER_MEMBER[parsed.provider],
      status: "connected",
      settings: parsed.settings as object,
      secretsEnc: hasSecrets ? encryptJson(parsed.secrets) : null,
      pollIntervalMinutes: parsed.pollIntervalMinutes,
      lastError: null,
      nextPollAt: new Date(),
    },
  });
  const saved = await prisma.mailboxAccount.findUniqueOrThrow({ where: { organizationId_address: { organizationId: ctx.organizationId, address: parsed.address } }, select: { mailboxRef: true } });

  // Evidence-driven setup completion: a mailbox exists, so the step is done.
  const { completeSetupStepFromEvidence } = await import("@/lib/onboarding/setup-progress-service.server");
  await completeSetupStepFromEvidence(ctx.organizationId, "mailroom").catch(() => null);

  const first = await pollMailboxNow(saved.mailboxRef);
  const firstRead = !first ? "Nothing to read yet." : first.ok ? `First read: ${first.data.ingested} new message${first.data.ingested === 1 ? "" : "s"}.` : `First read failed: ${first.error}`;
  revalidatePath(MAILROOM_PATH);
  return ok({ mailboxRef: saved.mailboxRef, mailboxLabel: probe.data.mailboxLabel, firstRead });
}

async function ownedMailbox(mailboxRef: string, organizationId: string) {
  return prisma.mailboxAccount.findFirst({ where: { mailboxRef, organizationId } });
}

export async function pauseMailbox(mailboxRef: string): Promise<ActionResult> {
  const ctx = await operatorContext();
  if (!ctx) return err("Operator account required.");
  const row = await ownedMailbox(mailboxRef, ctx.organizationId);
  if (!row) return err("Mailbox not found.");
  await prisma.mailboxAccount.update({ where: { id: row.id }, data: { status: row.status === "paused" ? "connected" : "paused", nextPollAt: row.status === "paused" ? new Date() : null } });
  revalidatePath(MAILROOM_PATH);
  return ok();
}

export async function removeMailbox(mailboxRef: string): Promise<ActionResult> {
  const ctx = await operatorContext();
  if (!ctx) return err("Operator account required.");
  const row = await ownedMailbox(mailboxRef, ctx.organizationId);
  if (!row) return err("Mailbox not found.");
  // Items keep their history; the relation is SetNull.
  await prisma.mailboxAccount.delete({ where: { id: row.id } });
  revalidatePath(MAILROOM_PATH);
  return ok();
}

export async function checkMailboxNow(mailboxRef: string): Promise<ActionResult<{ summary: string }>> {
  const ctx = await operatorContext();
  if (!ctx) return err("Operator account required.");
  const row = await ownedMailbox(mailboxRef, ctx.organizationId);
  if (!row) return err("Mailbox not found.");
  const outcome = await pollMailboxNow(mailboxRef);
  revalidatePath(MAILROOM_PATH);
  if (!outcome) return err("This mailbox is paused.");
  return outcome.ok ? ok({ summary: `${outcome.data.ingested} new, ${outcome.data.skipped} already seen.` }) : err(outcome.error);
}

export async function acknowledgeMailroomItem(inboundId: string): Promise<ActionResult> {
  const ctx = await operatorContext();
  if (!ctx) return err("Operator account required.");
  const item = await prisma.inboundChannelMessage.findFirst({ where: { inboundId, organizationId: ctx.organizationId, domain: "mailroom" }, select: { inboundId: true, mailroomStatus: true } });
  if (!item) return err("Message not found.");
  if (item.mailroomStatus !== "routed") return ok();
  const principalId = await resolvePrincipalIdForUser(ctx.userId);
  await prisma.inboundChannelMessage.update({ where: { inboundId }, data: { mailroomStatus: "acknowledged", acknowledgedAt: new Date(), acknowledgedByPrincipalId: principalId } });
  revalidatePath(MAILROOM_PATH);
  revalidatePath(`${MAILROOM_PATH}/items/${inboundId}`);
  revalidatePath("/workspace/inbox");
  return ok();
}

export async function draftMailroomReplyAction(inboundId: string): Promise<ActionResult<{ draftId: string }>> {
  const ctx = await operatorContext();
  if (!ctx) return err("Operator account required.");
  const item = await prisma.inboundChannelMessage.findFirst({ where: { inboundId, organizationId: ctx.organizationId, domain: "mailroom" } });
  if (!item) return err("Message not found.");
  const [profile, org] = await Promise.all([
    resolveOrganizationMailroomProfile(ctx.organizationId),
    prisma.organization.findUnique({ where: { id: ctx.organizationId }, select: { name: true } }),
  ]);
  const result = await draftMailroomReply({
    db: prisma as unknown as ReplyDb,
    profile,
    item,
    businessName: org?.name ?? "us",
    compose: composeMailroomReply,
    agentId: MAILROOM_AGENT_ID,
  });
  revalidatePath(`${MAILROOM_PATH}/items/${inboundId}`);
  return ok({ draftId: result.draftId });
}

type ApproveReplyResult = MailboxFormTypes["ApproveReplyResult"];

export async function approveAndSendMailroomReply(_prev: ApproveReplyResult | null, formData: FormData): Promise<ApproveReplyResult> {
  const ctx = await operatorContext();
  if (!ctx) return err("Operator account required.");
  const inboundId = field(formData, "inboundId");
  const draftId = field(formData, "draftId");
  const editedBody = field(formData, "body");
  const item = await prisma.inboundChannelMessage.findFirst({ where: { inboundId, organizationId: ctx.organizationId, domain: "mailroom" } });
  if (!item) return err("Message not found.");
  const result = await sendApprovedMailroomReply({
    db: prisma as unknown as ReplyDb,
    item,
    draftId,
    reviewerUserId: ctx.userId,
    editedBody,
    isEmailConfigured,
    sendMail: (options) => sendEmail(options),
  });
  revalidatePath(`${MAILROOM_PATH}/items/${inboundId}`);
  revalidatePath(MAILROOM_PATH);
  if (result.status === "sent") return ok({ messageId: result.messageId });
  if (result.status === "not-configured") return err(`Outbound email is not configured yet, so nothing was sent. Set it up under Settings (${result.settingsRoute}) and approve again.`);
  if (result.status === "no-recipient") return err("The message has no sender address to reply to.");
  return err("This draft is no longer pending, so it was not sent.");
}
