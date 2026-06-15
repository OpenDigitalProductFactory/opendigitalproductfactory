import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./email-config-core", () => ({
  writeSmtpConfig: vi.fn(),
  detectOrgEmailProvider: vi.fn(),
}));
vi.mock("./email", () => ({
  isEmailConfigured: vi.fn(),
  sendEmail: vi.fn(),
}));

import { writeSmtpConfig, detectOrgEmailProvider } from "./email-config-core";
import { isEmailConfigured, sendEmail } from "./email";
import { runEmailSetupTool } from "./email-setup-tool";

const mockWrite = vi.mocked(writeSmtpConfig);
const mockDetect = vi.mocked(detectOrgEmailProvider);
const mockIsConfigured = vi.mocked(isEmailConfigured);
const mockSend = vi.mocked(sendEmail);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runEmailSetupTool — detect", () => {
  it("returns the provider + credential hint when a provider is detected", async () => {
    mockDetect.mockResolvedValue({
      found: true,
      domain: "acme.com",
      via: "mx",
      preset: {
        id: "google-workspace",
        label: "Google Workspace / Gmail",
        host: "smtp.gmail.com",
        port: 587,
        secure: false,
        credentialHint: "Use a 16-char Google App Password.",
        docsUrl: "https://support.google.com/mail/answer/185833",
      },
    });
    const r = await runEmailSetupTool({ action: "detect" });
    expect(r.ok).toBe(true);
    expect(r.message).toContain("Google Workspace");
    expect(r.message).toContain("App Password");
    expect(r.message).toContain("smtp.gmail.com");
    expect(r.data).toMatchObject({ via: "mx", domain: "acme.com" });
  });

  it("guides the agent to ask the operator when no provider matches", async () => {
    mockDetect.mockResolvedValue({ found: false, domain: "acme.com", via: "none", preset: null });
    const r = await runEmailSetupTool({ action: "detect" });
    expect(r.ok).toBe(true);
    expect(r.message).toContain("acme.com");
    expect(r.message.toLowerCase()).toContain("ask the operator");
  });

  it("handles no org domain on file", async () => {
    mockDetect.mockResolvedValue({ found: false, domain: null, via: "none", preset: null });
    const r = await runEmailSetupTool({ action: "detect" });
    expect(r.ok).toBe(true);
    expect(r.message.toLowerCase()).toContain("no organization domain");
  });

  it("flags transactional services needing domain verification", async () => {
    mockDetect.mockResolvedValue({
      found: true,
      domain: "acme.com",
      via: "mx",
      preset: {
        id: "sendgrid",
        label: "Twilio SendGrid",
        host: "smtp.sendgrid.net",
        port: 587,
        secure: false,
        credentialHint: "Username is 'apikey'; password is an API key.",
        sharedRelay: true,
      },
    });
    const r = await runEmailSetupTool({ action: "detect" });
    expect(r.message).toContain("SPF/DKIM");
  });
});

describe("runEmailSetupTool — save", () => {
  it("persists settings via writeSmtpConfig and confirms", async () => {
    const r = await runEmailSetupTool({
      action: "save",
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      user: "owner@acme.com",
      from: "Acme <owner@acme.com>",
      pass: "app-password-16",
    });
    expect(r.ok).toBe(true);
    expect(mockWrite).toHaveBeenCalledWith(
      expect.objectContaining({ host: "smtp.gmail.com", port: 587, pass: "app-password-16" }),
    );
    expect(r.message.toLowerCase()).toContain("test");
  });

  it("omits a blank password so an existing one is never clobbered", async () => {
    await runEmailSetupTool({ action: "save", host: "smtp.gmail.com", pass: "" });
    const arg = mockWrite.mock.calls[0][0];
    expect(arg).not.toHaveProperty("pass");
  });

  it("refuses without a host (no write)", async () => {
    const r = await runEmailSetupTool({ action: "save", host: "  " });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("missing_host");
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("returns a clean failure when the write throws (e.g. validation)", async () => {
    mockWrite.mockRejectedValue(new Error("SMTP host is required"));
    const r = await runEmailSetupTool({ action: "save", host: "x" });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("email_setup_failed");
    expect(r.message).toContain("SMTP host is required");
  });
});

describe("runEmailSetupTool — test", () => {
  it("sends a test email when configured", async () => {
    mockIsConfigured.mockResolvedValue(true);
    mockSend.mockResolvedValue({ messageId: "msg-1" });
    const r = await runEmailSetupTool({ action: "test", to: "owner@acme.com" });
    expect(r.ok).toBe(true);
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ to: "owner@acme.com" }));
    expect(r.data).toMatchObject({ messageId: "msg-1" });
  });

  it("refuses without a recipient", async () => {
    const r = await runEmailSetupTool({ action: "test", to: "" });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("missing_recipient");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("refuses when email is not configured yet", async () => {
    mockIsConfigured.mockResolvedValue(false);
    const r = await runEmailSetupTool({ action: "test", to: "owner@acme.com" });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("not_configured");
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe("runEmailSetupTool — unknown action", () => {
  it("rejects an unrecognized action", async () => {
    const r = await runEmailSetupTool({ action: "frobnicate" as never });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("unknown_action");
  });
});
