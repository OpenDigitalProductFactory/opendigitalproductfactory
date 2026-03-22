import { describe, it, expect, vi, beforeEach } from "vitest";
import { determineSocialAuthFlow, createTempToken, verifyTempToken } from "./social-auth.js";

vi.mock("@dpf/db", () => ({
  prisma: {
    socialIdentity: {
      findUnique: vi.fn(),
    },
    customerContact: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";

describe("determineSocialAuthFlow", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns 'sign-in' when SocialIdentity exists", async () => {
    (prisma.socialIdentity.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "si-1",
      contactId: "c-1",
      contact: {
        id: "c-1",
        email: "user@test.com",
        name: null,
        isActive: true,
        account: { id: "a-1", accountId: "CUST-1234", name: "TestCo", status: "active" },
      },
    });
    const result = await determineSocialAuthFlow({
      provider: "google", providerAccountId: "google-123", email: "user@test.com", name: "Test User",
    });
    expect(result.flow).toBe("sign-in");
    if (result.flow === "sign-in") {
      expect(result.contact).toBeDefined();
    }
  });

  it("returns 'link' when email matches existing contact with password", async () => {
    (prisma.socialIdentity.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.customerContact.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "c-2", email: "existing@test.com", name: null, passwordHash: "$2a$12$somebcrypthash",
      isActive: true, account: { id: "a-2", accountId: "CUST-5678", name: "ExistCo", status: "active" },
    });
    const result = await determineSocialAuthFlow({
      provider: "google", providerAccountId: "google-456", email: "existing@test.com", name: "Existing User",
    });
    expect(result.flow).toBe("link");
    if (result.flow === "link") {
      expect(result.contact).toBeDefined();
    }
  });

  it("returns 'auto-link' when email matches contact with null password", async () => {
    (prisma.socialIdentity.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.customerContact.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "c-3", email: "nopw@test.com", name: null, passwordHash: null,
      isActive: true, account: { id: "a-3", accountId: "CUST-9999", name: "NoPwCo", status: "active" },
    });
    const result = await determineSocialAuthFlow({
      provider: "apple", providerAccountId: "apple-789", email: "nopw@test.com", name: "NoPw User",
    });
    expect(result.flow).toBe("auto-link");
  });

  it("returns 'onboard' when no identity or contact match", async () => {
    (prisma.socialIdentity.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.customerContact.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const result = await determineSocialAuthFlow({
      provider: "google", providerAccountId: "google-new", email: "brand-new@test.com", name: "New User",
    });
    expect(result.flow).toBe("onboard");
    if (result.flow === "onboard") {
      expect("contact" in result).toBe(false);
    }
  });

  it("returns 'blocked' when matched contact is inactive", async () => {
    (prisma.socialIdentity.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.customerContact.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "c-4", email: "inactive@test.com", name: null, passwordHash: "somehash",
      isActive: false, account: { id: "a-4", accountId: "CUST-0000", name: "InactiveCo", status: "active" },
    });
    const result = await determineSocialAuthFlow({
      provider: "google", providerAccountId: "google-inactive", email: "inactive@test.com", name: "Inactive User",
    });
    expect(result.flow).toBe("blocked");
  });
});

describe("temp tokens", () => {
  it("creates and verifies a temp token", async () => {
    const payload = { provider: "google", providerAccountId: "g-1", email: "a@b.com", name: "A" };
    const token = await createTempToken(payload);
    expect(typeof token).toBe("string");
    const verified = await verifyTempToken(token);
    expect(verified.provider).toBe("google");
    expect(verified.providerAccountId).toBe("g-1");
    expect(verified.email).toBe("a@b.com");
  });
  it("rejects an invalid token", async () => {
    await expect(verifyTempToken("garbage")).rejects.toThrow();
  });
});
