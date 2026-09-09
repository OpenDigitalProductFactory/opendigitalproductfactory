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
import { MAILBOX_PROVIDER_MEMBER, MAILBOX_PROVIDERS, type MailboxProviderKey } from "@dpf/db/mailroom-enums";

import { auth } from "@/lib/auth";
import { encryptJson } from "@/lib/govern/credential-crypto";
import { resolvePrincipalIdForUser } from "@/lib/identity/principal-linking";
import { MAILROOM_AGENT_ID } from "@/lib/mailroom/classifier";
import { createMailboxProviderAdapters } from "@/lib/mailroom/providers/registry";
import type { MailboxSecretsByProvider, MailboxSettingsByProvider } from "@/lib/mailroom/providers/types";
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

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function newMailboxId(): string {
  return `MBX-${randomBytes(4).toString("hex").toUpperCase()}`;
}

export type ConnectMailboxResult = ActionResult<{ mailboxId: string; mailboxLabel: string; firstRead: string }>;

/** Parse the connect form into provider settings + secrets. Exported for tests. */
export function parseMailboxForm(formData: FormData):
  | { ok: true; provider: MailboxProviderKey; address: string; purposeKey: string; displayName: string | null; pollIntervalMinutes: number; settings: unknown; secrets: unknown }
  | { ok: false; error: string } {
  const provider = field(formData, "provider") as MailboxProviderKey;
  if (!MAILBOX_PROVIDERS.includes(provider)) return { ok: false, error: "Choose a mailbox provider." };
  const address = field(formData, "address").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return { ok: false, error: "Enter the mailbox address." };
  const purposeKey = field(formData, "purposeKey");
  if (!purposeKey) return { ok: false, error: "Choose what this mailbox is for." };
  const displayName = field(formData, "displayName") || null;
  const interval = Number(field(formData, "pollIntervalMinutes") || "60");
  const pollIntervalMinutes = Number.isFinite(interval) && interval >= 5 && interval <= 24 * 60 ? Math.round(interval) : 60;

  if (provider === "imap") {
    const host = field(formData, "host");
    const port = Number(field(formData, "port") || "993");
    const user = field(formData, "user") || address;
    const password = field(formData, "password");
    if (!host) return { ok: false, error: "Enter the IMAP server." };
    if (!password) return { ok: false, error: "Enter the mailbox password or app password." };
    const settings: MailboxSettingsByProvider["imap"] = { host, port: Number.isFinite(port) ? port : 993, secure: port !== 143, user, folder: field(formData, "folder") || "INBOX" };
    const secrets: MailboxSecretsByProvider["imap"] = { password };
    return { ok: true, provider, address, purposeKey, displayName, pollIntervalMinutes, settings, secrets };
  }
  if (provider === "microsoft365") {
    const tenantId = field(formData, "tenantId");
    const clientId = field(formData, "clientId");
    const clientSecret = field(formData, "clientSecret");
    if (!tenantId || !clientId || !clientSecret) return { ok: false, error: "Enter the Microsoft 365 tenant, application (client) id and client secret." };
    const settings: MailboxSettingsByProvider["microsoft365"] = { tenantId, clientId, mailboxUserPrincipalName: address };
    const secrets: MailboxSecretsByProvider["microsoft365"] = { clientSecret };
    return { ok: true, provider, address, purposeKey, displayName, pollIntervalMinutes, settings, secrets };
  }
  const settings: MailboxSettingsByProvider["postmark-inbound"] = { inboundAddress: address };
  return { ok: true, provider, address, purposeKey, displayName, pollIntervalMinutes, settings, secrets: {} };
}

export async function connectMailbox(_prev: ConnectMailboxResult | null, formData: FormData): Promise<ConnectMailboxResult> {
  const ctx = await operatorContext();
  if (!ctx) return err("You need an operator account to connect a mailbox.");
  const parsed = parseMailboxForm(formData);
  if (!parsed.ok) return err(parsed.error);

  const profile = await resolveOrganizationMailroomProfile(ctx.organizationId);
  if (!profile.expectedMailboxes.some((m) => m.purposeKey === parsed.purposeKey)) return err("That purpose is not one this business uses.");

  const adapters = createMailboxProviderAdapters();
  const adapter = adapters[parsed.provider] as { probe: (s: unknown, x: unknown) => Promise<{ ok: true; mailboxLabel: string } | { ok: false; error: string }> };
  const probe = await adapter.probe(parsed.settings, parsed.secrets);
  if (!probe.ok) return err(`Could not read that mailbox: ${probe.error}`);

  const principalId = await resolvePrincipalIdForUser(ctx.userId);
  const mailboxId = newMailboxId();
  const hasSecrets = parsed.secrets && Object.keys(parsed.secrets as object).length > 0;
  await prisma.mailboxAccount.upsert({
    where: { organizationId_address: { organizationId: ctx.organizationId, address: parsed.address } },
    create: {
      mailboxId,
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
  const saved = await prisma.mailboxAccount.findUniqueOrThrow({ where: { organizationId_address: { organizationId: ctx.organizationId, address: parsed.address } }, select: { mailboxId: true } });

  // Evidence-driven setup completion: a mailbox exists, so the step is done.
  const { completeSetupStepFromEvidence } = await import("@/lib/onboarding/setup-progress-service.server");
  await completeSetupStepFromEvidence(ctx.organizationId, "mailroom").catch(() => null);

  const first = await pollMailboxNow(saved.mailboxId);
  const firstRead = !first ? "Nothing to read yet." : first.ok ? `First read: ${first.ingested} new message${first.ingested === 1 ? "" : "s"}.` : `First read failed: ${first.error}`;
  revalidatePath(MAILROOM_PATH);
  return ok({ mailboxId: saved.mailboxId, mailboxLabel: probe.mailboxLabel, firstRead });
}

async function ownedMailbox(mailboxId: string, organizationId: string) {
  return prisma.mailboxAccount.findFirst({ where: { mailboxId, organizationId } });
}

export async function pauseMailbox(mailboxId: string): Promise<ActionResult> {
  const ctx = await operatorContext();
  if (!ctx) return err("Operator account required.");
  const row = await ownedMailbox(mailboxId, ctx.organizationId);
  if (!row) return err("Mailbox not found.");
  await prisma.mailboxAccount.update({ where: { id: row.id }, data: { status: row.status === "paused" ? "connected" : "paused", nextPollAt: row.status === "paused" ? new Date() : null } });
  revalidatePath(MAILROOM_PATH);
  return ok();
}

export async function removeMailbox(mailboxId: string): Promise<ActionResult> {
  const ctx = await operatorContext();
  if (!ctx) return err("Operator account required.");
  const row = await ownedMailbox(mailboxId, ctx.organizationId);
  if (!row) return err("Mailbox not found.");
  // Items keep their history; the relation is SetNull.
  await prisma.mailboxAccount.delete({ where: { id: row.id } });
  revalidatePath(MAILROOM_PATH);
  return ok();
}

export async function checkMailboxNow(mailboxId: string): Promise<ActionResult<{ summary: string }>> {
  const ctx = await operatorContext();
  if (!ctx) return err("Operator account required.");
  const row = await ownedMailbox(mailboxId, ctx.organizationId);
  if (!row) return err("Mailbox not found.");
  const outcome = await pollMailboxNow(mailboxId);
  revalidatePath(MAILROOM_PATH);
  if (!outcome) return err("This mailbox is paused.");
  return outcome.ok ? ok({ summary: `${outcome.ingested} new, ${outcome.skipped} already seen.` }) : err(outcome.error);
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

export type ApproveReplyResult = ActionResult<{ messageId: string }>;

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
  if (result.ok) return ok({ messageId: result.messageId });
  if (result.reason === "not-configured") return err(`Outbound email is not configured yet, so nothing was sent. Set it up under Settings (${result.settingsRoute}) and approve again.`);
  if (result.reason === "no-recipient") return err("The message has no sender address to reply to.");
  return err("This draft is no longer pending, so it was not sent.");
}
