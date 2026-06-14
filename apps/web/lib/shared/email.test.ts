import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Shared sendMail spy (hoisted) so tests can assert the From/Reply-To headers.
const { sendMailMock } = vi.hoisted(() => ({ sendMailMock: vi.fn() }));
vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail: sendMailMock })),
  },
}));

// No in-portal SMTP config in these tests → resolveSmtpConfig falls back to env vars.
vi.mock("@dpf/db", () => ({
  prisma: { platformConfig: { findMany: vi.fn(() => Promise.resolve([])) } },
}));

import { sendEmail, composeInvoiceEmail, isEmailConfigured } from "./email";

beforeEach(() => {
  sendMailMock.mockReset();
  sendMailMock.mockResolvedValue({ messageId: "test-123" });
});

describe("composeInvoiceEmail", () => {
  const params = {
    to: "jane@acme.com",
    invoiceRef: "INV-2026-0001",
    accountName: "Acme Corp",
    totalAmount: "360.00",
    currency: "GBP",
    dueDate: "20 April 2026",
    payUrl: "https://example.com/s/pay/abc123",
  };

  it("composes email with correct subject", () => {
    const result = composeInvoiceEmail(params);
    expect(result.subject).toContain("INV-2026-0001");
    expect(result.to).toBe("jane@acme.com");
  });

  it("names the issuing org in the subject when provided", () => {
    const result = composeInvoiceEmail({ ...params, orgName: "Acme Trading Ltd" });
    expect(result.subject).toBe("Invoice INV-2026-0001 from Acme Trading Ltd");
  });

  it("omits the issuer clause (no 'your provider' placeholder) when org is unknown", () => {
    const result = composeInvoiceEmail(params);
    expect(result.subject).toBe("Invoice INV-2026-0001");
    expect(result.subject).not.toContain("your provider");
  });

  it("includes pay URL in html body", () => {
    const result = composeInvoiceEmail(params);
    expect(result.html).toContain("https://example.com/s/pay/abc123");
    expect(result.html).toContain("Pay Now");
  });

  it("includes invoice ref in text body", () => {
    const result = composeInvoiceEmail(params);
    expect(result.text).toContain("INV-2026-0001");
  });

  it("includes amount and due date", () => {
    const result = composeInvoiceEmail(params);
    expect(result.html).toContain("360.00");
    expect(result.html).toContain("20 April 2026");
  });
});

describe("isEmailConfigured", () => {
  it("returns true when SMTP_HOST is set (env fallback)", async () => {
    const saved = process.env.SMTP_HOST;
    process.env.SMTP_HOST = "smtp.test.example";
    expect(await isEmailConfigured()).toBe(true);
    if (saved === undefined) delete process.env.SMTP_HOST;
    else process.env.SMTP_HOST = saved;
  });

  it("returns false when SMTP_HOST is unset (cold-start fresh install)", async () => {
    const saved = process.env.SMTP_HOST;
    delete process.env.SMTP_HOST;
    expect(await isEmailConfigured()).toBe(false);
    if (saved !== undefined) process.env.SMTP_HOST = saved;
  });

  it("returns false when SMTP_HOST is empty", async () => {
    const saved = process.env.SMTP_HOST;
    process.env.SMTP_HOST = "";
    expect(await isEmailConfigured()).toBe(false);
    if (saved === undefined) delete process.env.SMTP_HOST;
    else process.env.SMTP_HOST = saved;
  });
});

describe("sendEmail", () => {
  it("calls transport.sendMail and returns messageId", async () => {
    process.env.SMTP_HOST = "smtp.test.example";
    const result = await sendEmail({
      to: "test@example.com",
      subject: "Test",
      text: "Hello",
      html: "<p>Hello</p>",
    });
    delete process.env.SMTP_HOST;
    expect(result.messageId).toBe("test-123");
  });

  it("throws in production when SMTP is unconfigured (no fake success)", async () => {
    const savedHost = process.env.SMTP_HOST;
    delete process.env.SMTP_HOST;
    vi.stubEnv("NODE_ENV", "production");

    await expect(
      sendEmail({ to: "x@example.com", subject: "S", text: "t", html: "<p>t</p>" }),
    ).rejects.toThrow(/SMTP is not configured/);

    vi.unstubAllEnvs();
    if (savedHost === undefined) delete process.env.SMTP_HOST;
    else process.env.SMTP_HOST = savedHost;
  });

  it("logs and returns a dev messageId when SMTP is unconfigured outside production", async () => {
    const savedHost = process.env.SMTP_HOST;
    delete process.env.SMTP_HOST;
    vi.stubEnv("NODE_ENV", "test");

    const result = await sendEmail({ to: "x@example.com", subject: "S", text: "t", html: "<p>t</p>" });
    expect(result.messageId).toMatch(/^dev-/);

    vi.unstubAllEnvs();
    if (savedHost === undefined) delete process.env.SMTP_HOST;
    else process.env.SMTP_HOST = savedHost;
  });

  it("sends with the caller's From and no Reply-To over operator SMTP (no rewrite)", async () => {
    const saved = process.env.SMTP_HOST;
    process.env.SMTP_HOST = "smtp.test.example";

    await sendEmail({
      to: "c@example.com",
      subject: "S",
      text: "t",
      html: "<p>t</p>",
      from: "Acme <billing@acme.com>",
    });

    const arg = sendMailMock.mock.calls[0][0];
    expect(arg.from).toBe("Acme <billing@acme.com>");
    expect(arg.replyTo).toBeUndefined();

    if (saved === undefined) delete process.env.SMTP_HOST;
    else process.env.SMTP_HOST = saved;
  });
});

describe("sendEmail — relay From-rewrite (tier 3)", () => {
  const RELAY_KEYS = ["DPF_EMAIL_RELAY_HOST", "DPF_EMAIL_RELAY_FROM", "SMTP_HOST"];
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const k of RELAY_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of RELAY_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("rewrites From to the relay address and preserves the business sender as Reply-To", async () => {
    process.env.DPF_EMAIL_RELAY_HOST = "relay.internal";
    process.env.DPF_EMAIL_RELAY_FROM = "noreply@relay.internal";

    await sendEmail({
      to: "customer@example.com",
      subject: "Invoice",
      text: "t",
      html: "<p>t</p>",
      from: "Acme Ltd <billing@acme.com>",
    });

    const arg = sendMailMock.mock.calls[0][0];
    expect(arg.from).toBe("noreply@relay.internal");
    expect(arg.replyTo).toBe("Acme Ltd <billing@acme.com>");
  });

  it("an explicit replyTo always wins over the rewrite default", async () => {
    process.env.DPF_EMAIL_RELAY_HOST = "relay.internal";
    process.env.DPF_EMAIL_RELAY_FROM = "noreply@relay.internal";

    await sendEmail({
      to: "customer@example.com",
      subject: "Invoice",
      text: "t",
      html: "<p>t</p>",
      from: "Acme Ltd <billing@acme.com>",
      replyTo: "support@acme.com",
    });

    expect(sendMailMock.mock.calls[0][0].replyTo).toBe("support@acme.com");
  });
});
