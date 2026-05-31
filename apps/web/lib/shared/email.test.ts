import { describe, expect, it, vi } from "vitest";

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: vi.fn().mockResolvedValue({ messageId: "test-123" }),
    })),
  },
}));

import { sendEmail, composeInvoiceEmail } from "./email";

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
});
