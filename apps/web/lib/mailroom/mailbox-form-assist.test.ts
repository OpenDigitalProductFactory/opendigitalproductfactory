// Mailroom connect form ↔ coworker form assist (BI-2A815481, AC-1..AC-3, AC-5).

import { describe, expect, it } from "vitest";

import {
  MAILBOX_FORM_ASSIST_ID,
  MAILBOX_SECRET_FIELD_NAMES,
  mailboxFormAssistFields,
  readMailboxFormValues,
  sanitizeMailboxFormUpdates,
} from "./mailbox-form-assist";

const purposes = [
  { purposeKey: "general", label: "General enquiries", examples: ["info@"], why: "w" },
  { purposeKey: "billing", label: "Billing and suppliers", examples: ["accounts@"], why: "w" },
];

describe("mailbox form assist", () => {
  it("shares every non-secret field, with Gmail guidance, and never a secret", () => {
    const fields = mailboxFormAssistFields(purposes);
    const keys = fields.map((f) => f.key);
    expect(keys).toEqual(
      expect.arrayContaining(["provider", "purposeKey", "address", "pollIntervalMinutes", "host", "port", "user", "folder", "displayName", "tenantId", "clientId"]),
    );
    for (const secret of MAILBOX_SECRET_FIELD_NAMES) expect(keys).not.toContain(secret);
    expect(fields.find((f) => f.key === "provider")?.allowedValues).toEqual(["imap", "microsoft365", "postmark-inbound"]);
    expect(fields.find((f) => f.key === "purposeKey")?.allowedValues).toEqual(["general", "billing"]);
    const host = fields.find((f) => f.key === "host")?.helperText ?? "";
    expect(host).toContain("imap.gmail.com");
    const provider = fields.find((f) => f.key === "provider")?.helperText ?? "";
    expect(provider).toMatch(/app password/i);
    expect(provider).toMatch(/never/i);
    expect(MAILBOX_FORM_ASSIST_ID).toBe("mailroom-connect-mailbox");
  });

  it("reads current values from the form data and drops secrets", () => {
    const data = new Map<string, string>([
      ["provider", "imap"],
      ["purposeKey", "billing"],
      ["address", "owner@example.test"],
      ["host", "imap.gmail.com"],
      ["port", "993"],
      ["password", "hunter2"],
      ["clientSecret", "s3cret"],
    ]);
    const values = readMailboxFormValues({ get: (k: string) => data.get(k) ?? null });
    expect(values).toMatchObject({ provider: "imap", purposeKey: "billing", address: "owner@example.test", host: "imap.gmail.com", port: "993" });
    expect(values).not.toHaveProperty("password");
    expect(values).not.toHaveProperty("clientSecret");
    expect(JSON.stringify(values)).not.toContain("hunter2");
  });

  it("applies only listed fields with valid values; secrets and bad values are dropped", () => {
    const clean = sanitizeMailboxFormUpdates(
      {
        provider: "imap",
        purposeKey: "billing",
        host: "imap.gmail.com",
        port: 993,
        pollIntervalMinutes: 3,
        folder: "DPF Mailroom",
        password: "guessed",
        clientSecret: "guessed",
        unknown: "x",
      },
      purposes,
    );
    expect(clean).toEqual({ provider: "imap", purposeKey: "billing", host: "imap.gmail.com", port: "993", folder: "DPF Mailroom" });
    expect(sanitizeMailboxFormUpdates({ provider: "smtp", purposeKey: "nope" }, purposes)).toEqual({});
    expect(sanitizeMailboxFormUpdates({ pollIntervalMinutes: 30, port: 70000 }, purposes)).toEqual({ pollIntervalMinutes: "30" });
  });
});
