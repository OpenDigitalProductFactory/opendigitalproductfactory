import { describe, it, expect, vi, beforeEach } from "vitest";
import { linkSocialIdentity, completeProfileWithSocial } from "./social-auth-actions.js";

const txMocks = vi.hoisted(() => ({
  customerAccountCreate: vi.fn().mockResolvedValue({ id: "a-new", accountId: "CUST-NEW", name: "NewCo" }),
  customerContactCreate: vi.fn().mockResolvedValue({ id: "c-new" }),
  customerContactFindUnique: vi.fn(),
  customerContactUpdate: vi.fn(),
  socialIdentityCreate: vi.fn().mockResolvedValue({ id: "si-new" }),
  accountInviteUpdate: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    socialIdentity: { create: vi.fn() },
    customerContact: { findUnique: vi.fn(), update: vi.fn() },
    customerAccount: { create: vi.fn() },
    accountInvite: { update: vi.fn() },
    $transaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn({
      customerAccount: { create: txMocks.customerAccountCreate },
      customerContact: {
        create: txMocks.customerContactCreate,
        findUnique: txMocks.customerContactFindUnique,
        update: txMocks.customerContactUpdate,
      },
      socialIdentity: { create: txMocks.socialIdentityCreate },
      accountInvite: { update: txMocks.accountInviteUpdate },
      principal: {},
      principalAlias: {},
      user: {},
    })),
  },
}));

vi.mock("@/lib/password", () => ({
  verifyPassword: vi.fn(),
  hashPassword: vi.fn(),
}));

vi.mock("@/lib/social-auth", () => ({
  verifyTempToken: vi.fn(),
}));

vi.mock("@/lib/identity/authentication", () => ({
  authorizeIdentityForSession: vi.fn(),
}));

vi.mock("@/lib/identity/principal-linking", () => ({
  syncCustomerPrincipal: vi.fn(),
}));

import { prisma } from "@dpf/db";
import { verifyPassword } from "@/lib/password";
import { verifyTempToken } from "@/lib/social-auth";
import { authorizeIdentityForSession } from "@/lib/identity/authentication";
import { syncCustomerPrincipal } from "@/lib/identity/principal-linking";

describe("linkSocialIdentity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    txMocks.customerContactFindUnique.mockResolvedValue({
      id: "c-1", email: "user@test.com", name: null, passwordHash: "$2a$12$hash",
      isActive: true, mergedIntoId: null,
      account: { id: "a-1", accountId: "CUST-1", name: "Co", status: "active" },
    });
    vi.mocked(authorizeIdentityForSession).mockResolvedValue({
      authorized: true, principalId: "PRN-1", principalRecordId: "p-1",
      credentialId: "c-1", population: "customer", authority: "install",
    });
  });

  it("links identity when password is correct", async () => {
    (verifyTempToken as ReturnType<typeof vi.fn>).mockResolvedValue({
      provider: "google", providerAccountId: "g-1", email: "user@test.com", name: "User",
    });
    (prisma.customerContact.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "c-1", email: "user@test.com", name: null, passwordHash: "$2a$12$hash",
      isActive: true, account: { id: "a-1", accountId: "CUST-1", name: "Co", status: "active" },
    });
    (verifyPassword as ReturnType<typeof vi.fn>).mockResolvedValue({ valid: true, needsRehash: false });
    (prisma.socialIdentity.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "si-1" });

    const result = await linkSocialIdentity("valid-token", "correctpassword");
    expect(result.success).toBe(true);
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(txMocks.socialIdentityCreate).toHaveBeenCalled();
    expect(prisma.socialIdentity.create).not.toHaveBeenCalled();
    expect(authorizeIdentityForSession).toHaveBeenCalledWith(
      { population: "customer", credentialId: "c-1" },
      expect.anything(),
    );
  });

  it("rejects when password is wrong", async () => {
    (verifyTempToken as ReturnType<typeof vi.fn>).mockResolvedValue({
      provider: "google", providerAccountId: "g-1", email: "user@test.com", name: "User",
    });
    (prisma.customerContact.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "c-1", email: "user@test.com", name: null, passwordHash: "$2a$12$hash",
      isActive: true, account: { id: "a-1", accountId: "CUST-1", name: "Co", status: "active" },
    });
    (verifyPassword as ReturnType<typeof vi.fn>).mockResolvedValue({ valid: false, needsRehash: false });

    const result = await linkSocialIdentity("valid-token", "wrongpassword");
    expect(result.success).toBe(false);
    expect(result.error).toContain("password");
  });
});

describe("completeProfileWithSocial", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(syncCustomerPrincipal).mockResolvedValue({
      id: "p-1", principalId: "PRN-1", kind: "customer", status: "active",
      displayName: "new@test.com", sensitivityClearance: ["public"], aliases: [],
    });
  });

  it("creates account + contact + identity for new company", async () => {
    (verifyTempToken as ReturnType<typeof vi.fn>).mockResolvedValue({
      provider: "google", providerAccountId: "g-new", email: "new@test.com", name: "New User",
    });
    (prisma.customerContact.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await completeProfileWithSocial("valid-token", { mode: "create", companyName: "New Corp" });
    expect(result.success).toBe(true);
    expect(syncCustomerPrincipal).toHaveBeenCalledWith("c-new", expect.anything());
    expect(txMocks.socialIdentityCreate).toHaveBeenCalled();
  });
});
