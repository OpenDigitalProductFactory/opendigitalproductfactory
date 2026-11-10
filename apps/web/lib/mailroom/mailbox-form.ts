// Mailbox connect-form parsing (design 2026-09-09 §4.9). Plain module: the server
// actions file may export only async functions, so the synchronous parser and
// the result types live here and are imported by both the actions and the UI.

import { MAILBOX_PROVIDERS, type MailboxProviderKey } from "@dpf/db/mailroom-enums";

import type { MailboxSecretsByProvider, MailboxSettingsByProvider } from "@/lib/mailroom/providers/types";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";

export type MailboxFormTypes = {
  ConnectMailboxResult: ActionResult<{ mailboxRef: string; mailboxLabel: string; firstRead: string }>;
  ApproveReplyResult: ActionResult<{ messageId: string }>;
};
export type ConnectMailboxResult = MailboxFormTypes["ConnectMailboxResult"];
export type ApproveReplyResult = MailboxFormTypes["ApproveReplyResult"];

export function formField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

const field = formField;

export type ParsedMailboxForm = { provider: MailboxProviderKey; address: string; purposeKey: string; displayName: string | null; pollIntervalMinutes: number; settings: unknown; secrets: unknown };

export function parseMailboxForm(formData: FormData): ActionResult<ParsedMailboxForm> {
  const provider = field(formData, "provider") as MailboxProviderKey;
  if (!MAILBOX_PROVIDERS.includes(provider)) return err("Choose a mailbox provider.");
  const address = field(formData, "address").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return err("Enter the mailbox address.");
  const purposeKey = field(formData, "purposeKey");
  if (!purposeKey) return err("Choose what this mailbox is for.");
  const displayName = field(formData, "displayName") || null;
  const interval = Number(field(formData, "pollIntervalMinutes") || "60");
  const pollIntervalMinutes = Number.isFinite(interval) && interval >= 5 && interval <= 24 * 60 ? Math.round(interval) : 60;

  if (provider === "imap") {
    const host = field(formData, "host");
    const port = Number(field(formData, "port") || "993");
    const user = field(formData, "user") || address;
    const password = field(formData, "password");
    if (!host) return err("Enter the IMAP server.");
    if (!password) return err("Enter the mailbox password or app password.");
    const settings: MailboxSettingsByProvider["imap"] = { host, port: Number.isFinite(port) ? port : 993, secure: port !== 143, user, folder: field(formData, "folder") || "INBOX" };
    const secrets: MailboxSecretsByProvider["imap"] = { password };
    return ok<ParsedMailboxForm>({ provider, address, purposeKey, displayName, pollIntervalMinutes, settings, secrets });
  }
  if (provider === "microsoft365") {
    const tenantId = field(formData, "tenantId");
    const clientId = field(formData, "clientId");
    const clientSecret = field(formData, "clientSecret");
    if (!tenantId || !clientId || !clientSecret) return err("Enter the Microsoft 365 tenant, application (client) id and client secret.");
    const settings: MailboxSettingsByProvider["microsoft365"] = { tenantId, clientId, mailboxUserPrincipalName: address };
    const secrets: MailboxSecretsByProvider["microsoft365"] = { clientSecret };
    return ok<ParsedMailboxForm>({ provider, address, purposeKey, displayName, pollIntervalMinutes, settings, secrets });
  }
  const settings: MailboxSettingsByProvider["postmark-inbound"] = { inboundAddress: address };
  return ok<ParsedMailboxForm>({ provider, address, purposeKey, displayName, pollIntervalMinutes, settings, secrets: {} });
}
