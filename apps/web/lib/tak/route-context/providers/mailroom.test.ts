// Mailroom page context for the coworker (BI-2A815481, AC-4).

import { describe, expect, it } from "vitest";

import { formatMailroomContext } from "./mailroom";

const purposes = [
  { purposeKey: "general", label: "General enquiries" },
  { purposeKey: "billing", label: "Billing and suppliers" },
];

describe("mailroom page context", () => {
  it("with no mailbox it says so, says the native connector is on this page, and rules out bridges", () => {
    const text = formatMailroomContext({ mailboxes: [], purposes, openItems: 0 });
    expect(text).toContain("PAGE DATA — Mailroom");
    expect(text).toContain("No mailbox is connected yet");
    expect(text).toMatch(/Connect a mailbox/);
    expect(text).toMatch(/IMAP/);
    expect(text).toMatch(/Microsoft 365/);
    expect(text).toMatch(/do not suggest .*third-party/i);
    expect(text).toMatch(/never ask .*password/i);
    expect(text).toContain("Billing and suppliers");
  });

  it("names each mailbox with purpose, provider, status and last read", () => {
    const text = formatMailroomContext({
      mailboxes: [
        {
          address: "accounts@example.test",
          purposeKey: "billing",
          provider: "imap",
          status: "active",
          lastPolledAt: new Date("2026-11-14T19:00:00Z"),
          lastPollStatus: "error",
          lastError: "AUTHENTICATIONFAILED",
        },
      ],
      purposes,
      openItems: 3,
    });
    expect(text).toContain("accounts@example.test");
    expect(text).toContain("Billing and suppliers");
    expect(text).toContain("imap");
    expect(text).toContain("active");
    expect(text).toContain("2026-11-14T19:00:00.000Z");
    expect(text).toContain("AUTHENTICATIONFAILED");
    expect(text).toContain("3 routed messages are waiting");
  });
});
