// Connect-a-mailbox form ↔ the coworker's form assist (BI-2A815481).
//
// The coworker beside the Mailroom page reads this form through the shared
// form-assist substrate (lib/tak/agent-form-assist.ts), the same way it reads
// the backlog editor, and may fill its non-secret fields when the owner asks.
// The password and client secret are never shared with the coworker and can
// never be filled by it: they are absent from the field list, dropped when
// values are read, and dropped again when updates are applied. Credentials are
// entered by the owner only.

import type { AgentFormAssistField } from "@/lib/agent-form-assist";

export const MAILBOX_FORM_ASSIST_ID = "mailroom-connect-mailbox";

/** Form field names that hold credentials. Never shared, never filled. */
export const MAILBOX_SECRET_FIELD_NAMES = ["password", "clientSecret"] as const;

const PROVIDERS = ["imap", "microsoft365", "postmark-inbound"] as const;

type PurposeOption = { purposeKey: string; label: string };

/** The fields the coworker may see and fill, with guidance it can pass on. */
export function mailboxFormAssistFields(purposes: readonly PurposeOption[]): AgentFormAssistField[] {
  return [
    {
      key: "provider",
      label: "Provider",
      type: "select",
      allowedValues: [...PROVIDERS],
      helperText:
        "This form is DPF's own mailbox connector; no other integration is needed. Use imap for Gmail, Google Workspace, Outlook.com and most mail servers. " +
        "Gmail requires 2-Step Verification and an app password (Google account › Security › App passwords), not the normal password. " +
        "The owner types the password into the form themself; never ask for it, repeat it or fill it.",
    },
    {
      key: "purposeKey",
      label: "What this mailbox is for",
      type: "select",
      allowedValues: purposes.map((p) => p.purposeKey),
      helperText: `Options: ${purposes.map((p) => `${p.purposeKey} = ${p.label}`).join("; ")}. Supplier invoices and bills belong to the billing purpose when the profile has one.`,
    },
    { key: "address", label: "Mailbox address", type: "text", helperText: "The email address being read." },
    {
      key: "pollIntervalMinutes",
      label: "Read every (minutes)",
      type: "number",
      helperText: "5 to 1440. The default of 60 reads hourly.",
    },
    {
      key: "host",
      label: "IMAP server",
      type: "text",
      helperText: "Gmail and Google Workspace: imap.gmail.com. Outlook.com: outlook.office365.com. Otherwise ask the mail provider.",
    },
    { key: "port", label: "Port", type: "number", helperText: "993 for IMAP over TLS (Gmail, Outlook.com)." },
    { key: "user", label: "Login", type: "text", helperText: "Leave blank to log in with the mailbox address." },
    {
      key: "folder",
      label: "Folder",
      type: "text",
      helperText:
        "INBOX reads the whole inbox. A Gmail label name (for example a label a filter applies to bills and counsel mail) reads only that label. The first read takes the last 14 days.",
    },
    { key: "displayName", label: "Shown as", type: "text", helperText: "Optional name shown in the Mailroom." },
    { key: "tenantId", label: "Microsoft 365 tenant id", type: "text", helperText: "Only for the microsoft365 provider." },
    { key: "clientId", label: "Microsoft 365 application (client) id", type: "text", helperText: "Only for the microsoft365 provider." },
  ];
}

const SHARED_KEYS = [
  "provider",
  "purposeKey",
  "address",
  "pollIntervalMinutes",
  "host",
  "port",
  "user",
  "folder",
  "displayName",
  "tenantId",
  "clientId",
] as const;

/** Current values from the form, with every secret dropped. */
export function readMailboxFormValues(data: { get(name: string): FormDataEntryValue | string | null }): Record<string, string> {
  const values: Record<string, string> = {};
  for (const key of SHARED_KEYS) {
    const value = data.get(key);
    if (typeof value === "string") values[key] = value;
  }
  return values;
}

function intInRange(value: unknown, min: number, max: number): string | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? String(n) : null;
}

/** The coworker's proposed updates, limited to listed fields with valid values. */
export function sanitizeMailboxFormUpdates(updates: Record<string, unknown>, purposes: readonly PurposeOption[]): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(updates)) {
    if ((MAILBOX_SECRET_FIELD_NAMES as readonly string[]).includes(key)) continue;
    switch (key) {
      case "provider":
        if (typeof value === "string" && (PROVIDERS as readonly string[]).includes(value)) clean.provider = value;
        break;
      case "purposeKey":
        if (typeof value === "string" && purposes.some((p) => p.purposeKey === value)) clean.purposeKey = value;
        break;
      case "pollIntervalMinutes": {
        const n = intInRange(value, 5, 1440);
        if (n) clean.pollIntervalMinutes = n;
        break;
      }
      case "port": {
        const n = intInRange(value, 1, 65535);
        if (n) clean.port = n;
        break;
      }
      case "address":
      case "host":
      case "user":
      case "folder":
      case "displayName":
      case "tenantId":
      case "clientId":
        if (typeof value === "string") clean[key] = value.trim();
        break;
      default:
        break;
    }
  }
  return clean;
}
