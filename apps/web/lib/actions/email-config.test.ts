import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ can: vi.fn() }));
vi.mock("@dpf/db", () => ({
  prisma: {
    platformConfig: { upsert: vi.fn() },
    organization: { findFirst: vi.fn() },
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/govern/credential-crypto", () => ({
  encryptSecret: vi.fn((s: string) => `enc:${s}`),
}));
vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn().mockResolvedValue({ messageId: "x" }),
  isEmailConfigured: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/shared/smtp-config", () => ({ suggestSmtpForDomain: vi.fn() }));

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import { encryptSecret } from "@/lib/govern/credential-crypto";
import { sendEmail, isEmailConfigured } from "@/lib/email";
import { suggestSmtpForDomain } from "@/lib/shared/smtp-config";
import { saveEmailConfig, sendTestEmail, suggestEmailProvider } from "./email-config";

const mockAuth = vi.mocked(auth);
const mockCan = vi.mocked(can);
const mockPrisma = prisma as unknown as {
  platformConfig: { upsert: ReturnType<typeof vi.fn> };
  organization: { findFirst: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({
    user: { id: "u1", platformRole: "HR-000", isSuperuser: true },
  } as never);
  mockCan.mockReturnValue(true);
  mockPrisma.platformConfig.upsert.mockResolvedValue({});
  mockPrisma.organization.findFirst.mockResolvedValue(null);
  vi.mocked(isEmailConfigured).mockResolvedValue(true);
  vi.mocked(suggestSmtpForDomain).mockResolvedValue({ domain: null, via: "none", preset: null });
});

describe("saveEmailConfig", () => {
  it("throws when unauthorized", async () => {
    mockCan.mockReturnValue(false);
    await expect(saveEmailConfig({ host: "h", port: 587 })).rejects.toThrow("Unauthorized");
    expect(mockPrisma.platformConfig.upsert).not.toHaveBeenCalled();
  });

  it("requires a host", async () => {
    await expect(saveEmailConfig({ host: "", port: 587 } as never)).rejects.toThrow();
  });

  it("writes plaintext fields and encrypts the password when provided", async () => {
    await saveEmailConfig({
      host: "smtp.x",
      port: 465,
      user: "u",
      from: "f@x.com",
      secure: true,
      pass: "secret",
    });

    const keys = mockPrisma.platformConfig.upsert.mock.calls.map((c) => c[0].where.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "smtp_host",
        "smtp_port",
        "smtp_user",
        "smtp_from",
        "smtp_secure",
        "smtp_pass_enc",
      ]),
    );
    expect(encryptSecret).toHaveBeenCalledWith("secret");
    const passWrite = mockPrisma.platformConfig.upsert.mock.calls.find(
      (c) => c[0].where.key === "smtp_pass_enc",
    );
    expect(passWrite?.[0].create.value).toBe("enc:secret");
  });

  it("does NOT touch the password key when pass is blank (keeps existing)", async () => {
    await saveEmailConfig({ host: "smtp.x", port: 587 });
    const keys = mockPrisma.platformConfig.upsert.mock.calls.map((c) => c[0].where.key);
    expect(keys).not.toContain("smtp_pass_enc");
    expect(encryptSecret).not.toHaveBeenCalled();
  });
});

describe("sendTestEmail", () => {
  it("throws when unauthorized", async () => {
    mockCan.mockReturnValue(false);
    await expect(sendTestEmail("x@y.com")).rejects.toThrow("Unauthorized");
  });

  it("rejects an invalid recipient", async () => {
    await expect(sendTestEmail("not-an-email")).rejects.toThrow();
  });

  it("returns a not-configured result (does not throw) when email is unconfigured", async () => {
    vi.mocked(isEmailConfigured).mockResolvedValue(false);
    const r = await sendTestEmail("x@y.com");
    expect(r).toEqual({ ok: false, message: expect.stringMatching(/Save your SMTP settings/) });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends a test email when configured", async () => {
    const r = await sendTestEmail("x@y.com");
    expect(r).toEqual({ ok: true });
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "x@y.com" }));
  });

  it("returns the SMTP failure as data (not a thrown error) so it survives to the client", async () => {
    // A production build would redact a THROWN server-action message; returning
    // it as data is what keeps the real 535 reason readable (BI-6AA848A7).
    vi.mocked(sendEmail).mockRejectedValueOnce(
      Object.assign(new Error("Invalid login"), {
        code: "EAUTH",
        responseCode: 535,
        command: "AUTH LOGIN",
        response:
          "535 5.7.139 Authentication unsuccessful, SmtpClientAuthentication is disabled for the Tenant. Visit https://aka.ms/smtp_auth_disabled",
      }),
    );
    const r = await sendTestEmail("x@y.com");
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.responseCode).toBe(535);
    expect(r.command).toBe("AUTH LOGIN");
    expect(r.remediationUrl).toBe("https://aka.ms/smtp_auth_disabled");
    expect(r.message).toMatch(/SMTP AUTH/i);
  });
});

describe("suggestEmailProvider", () => {
  it("throws when unauthorized", async () => {
    mockCan.mockReturnValue(false);
    await expect(suggestEmailProvider()).rejects.toThrow("Unauthorized");
    expect(mockPrisma.organization.findFirst).not.toHaveBeenCalled();
  });

  it("seeds detection from the org email in preference to the website", async () => {
    mockPrisma.organization.findFirst.mockResolvedValue({
      email: "owner@acme.com",
      website: "https://acme.com",
    });
    await suggestEmailProvider();
    expect(suggestSmtpForDomain).toHaveBeenCalledWith("owner@acme.com");
  });

  it("falls back to the website when no org email is set", async () => {
    mockPrisma.organization.findFirst.mockResolvedValue({
      email: null,
      website: "https://acme.com",
    });
    await suggestEmailProvider();
    expect(suggestSmtpForDomain).toHaveBeenCalledWith("https://acme.com");
  });

  it("returns the detected provider preset", async () => {
    mockPrisma.organization.findFirst.mockResolvedValue({ email: "owner@gmail.com", website: null });
    vi.mocked(suggestSmtpForDomain).mockResolvedValue({
      domain: "gmail.com",
      via: "domain",
      preset: {
        id: "google-workspace",
        label: "Google Workspace / Gmail",
        host: "smtp.gmail.com",
        port: 587,
        secure: false,
        credentialHint: "Use an app password.",
      },
    });
    const r = await suggestEmailProvider();
    expect(r).toMatchObject({ found: true, domain: "gmail.com", via: "domain" });
    expect(r.preset?.host).toBe("smtp.gmail.com");
  });

  it("reports found:false when nothing is detected", async () => {
    const r = await suggestEmailProvider();
    expect(r).toMatchObject({ found: false, preset: null });
  });
});
