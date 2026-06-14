import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ can: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { platformConfig: { upsert: vi.fn() } } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/govern/credential-crypto", () => ({
  encryptSecret: vi.fn((s: string) => `enc:${s}`),
}));
vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn().mockResolvedValue({ messageId: "x" }),
  isEmailConfigured: vi.fn().mockResolvedValue(true),
}));

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import { encryptSecret } from "@/lib/govern/credential-crypto";
import { sendEmail, isEmailConfigured } from "@/lib/email";
import { saveEmailConfig, sendTestEmail } from "./email-config";

const mockAuth = vi.mocked(auth);
const mockCan = vi.mocked(can);
const mockPrisma = prisma as unknown as {
  platformConfig: { upsert: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({
    user: { id: "u1", platformRole: "HR-000", isSuperuser: true },
  } as never);
  mockCan.mockReturnValue(true);
  mockPrisma.platformConfig.upsert.mockResolvedValue({});
  vi.mocked(isEmailConfigured).mockResolvedValue(true);
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

  it("refuses when email is not configured", async () => {
    vi.mocked(isEmailConfigured).mockResolvedValue(false);
    await expect(sendTestEmail("x@y.com")).rejects.toThrow(/Save your SMTP settings/);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends a test email when configured", async () => {
    await sendTestEmail("x@y.com");
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "x@y.com" }));
  });
});
