import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/i18n/locale-context.server", () => ({
  getLocaleContext: async () => ({ language: "en-US", formatLocale: "en-US" }),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({
  can: vi.fn(),
}));

vi.mock("@/lib/governance-data", () => ({
  getUserTeamIds: vi.fn(),
  createAuthorizationDecisionLog: vi.fn(),
}));

vi.mock("@/lib/principal-context", () => ({
  buildPrincipalContext: vi.fn(),
}));

vi.mock("@/lib/governance-resolver", () => ({
  resolveGovernedAction: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    platformRole: { findUnique: vi.fn() },
    platformConfig: {
      findUnique: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    userGroup: {
      deleteMany: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
    },
    principalAlias: { findUnique: vi.fn() },
    s5RehearsalRequesterEnrollment: { findUnique: vi.fn() },
    passwordResetToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/identity/principal-linking", () => ({
  syncUserPrincipal: vi.fn(),
}));

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getUserTeamIds, createAuthorizationDecisionLog } from "@/lib/governance-data";
import { buildPrincipalContext } from "@/lib/principal-context";
import { resolveGovernedAction } from "@/lib/governance-resolver";
import { syncUserPrincipal } from "@/lib/identity/principal-linking";
import { prisma } from "@dpf/db";
import {
  addUserPlatformRole,
  adminIssuePasswordReset,
  adminResetUserPassword,
  completePasswordReset,
  createUserAccount,
  requestPasswordReset,
  updateUserLifecycle,
} from "./users";

const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockCan = can as ReturnType<typeof vi.fn>;
const mockGetUserTeamIds = getUserTeamIds as ReturnType<typeof vi.fn>;
const mockCreateAuthorizationDecisionLog = createAuthorizationDecisionLog as ReturnType<typeof vi.fn>;
const mockBuildPrincipalContext = buildPrincipalContext as ReturnType<typeof vi.fn>;
const mockResolveGovernedAction = resolveGovernedAction as ReturnType<typeof vi.fn>;
const mockPrisma = prisma as any;

const authorizedSession = {
  user: {
    id: "user-1",
    email: "admin@example.com",
    platformRole: "HR-300",
    isSuperuser: false,
  },
};

describe("user actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue(authorizedSession);
    mockCan.mockReturnValue(true);
    mockGetUserTeamIds.mockResolvedValue(["team-1"]);
    mockBuildPrincipalContext.mockReturnValue({ platformRoleIds: ["HR-300"] });
    mockResolveGovernedAction.mockReturnValue({ decision: "allow", rationaleCode: "ok" });
    mockCreateAuthorizationDecisionLog.mockResolvedValue(undefined);
    mockPrisma.$transaction.mockImplementation(
      async (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    mockPrisma.platformConfig.findUnique.mockResolvedValue(null);
    // Default: no enrolled S5 rehearsal requester (BI-9F7192F9); guard tests override.
    mockPrisma.s5RehearsalRequesterEnrollment.findUnique.mockResolvedValue(null);
    // Default: principal sync resolves (BI-4150F4D6); tests override as needed.
    (syncUserPrincipal as ReturnType<typeof vi.fn>).mockResolvedValue({} as never);
  });

  it("returns a neutral message for unknown emails", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const result = await requestPasswordReset({ email: "unknown@example.com" });

    expect(result.ok).toBe(true);
    expect(result.message).toContain("If an account exists");
    expect(mockPrisma.passwordResetToken.create).not.toHaveBeenCalled();
  });

  it("creates a manual recovery link when email is unavailable", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "target-user",
      email: "worker@example.com",
      isActive: true,
    });
    mockPrisma.passwordResetToken.create.mockResolvedValue({
      id: "reset-1",
    });

    const result = await adminIssuePasswordReset({ userId: "target-user" });

    expect(result.ok).toBe(true);
    expect(result.deliveryChannel).toBe("manual");
    expect(result.recoveryLink).toContain("/reset-password?token=");
  });

  it("consumes a valid token and updates the password hash", async () => {
    mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
      id: "reset-1",
      tokenHash: "ignored-in-mock-shape",
      expiresAt: new Date("2099-03-14T00:00:00.000Z"),
      consumedAt: null,
      user: {
        id: "target-user",
        email: "worker@example.com",
        isActive: true,
      },
    });

    const result = await completePasswordReset({
      token: "raw-token",
      newPassword: "ValidPassword1!",
      confirmPassword: "ValidPassword1!",
    });

    expect(result.ok).toBe(true);
    expect(mockPrisma.user.update).toHaveBeenCalledOnce();
    expect(mockPrisma.passwordResetToken.update).toHaveBeenCalledOnce();
  });

  it("rejects expired reset tokens", async () => {
    mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
      id: "reset-1",
      tokenHash: "ignored-in-mock-shape",
      expiresAt: new Date("2020-03-14T00:00:00.000Z"),
      consumedAt: null,
      user: {
        id: "target-user",
        email: "worker@example.com",
        isActive: true,
      },
    });

    const result = await completePasswordReset({
      token: "raw-token",
      newPassword: "ValidPassword1!",
      confirmPassword: "ValidPassword1!",
    });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/invalid or expired/i);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("rejects consumed reset tokens", async () => {
    mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
      id: "reset-1",
      tokenHash: "ignored-in-mock-shape",
      expiresAt: new Date("2099-03-14T00:00:00.000Z"),
      consumedAt: new Date("2026-03-14T00:00:00.000Z"),
      user: {
        id: "target-user",
        email: "worker@example.com",
        isActive: true,
      },
    });

    const result = await completePasswordReset({
      token: "raw-token",
      newPassword: "ValidPassword1!",
      confirmPassword: "ValidPassword1!",
    });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/invalid or expired/i);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("still enforces the password policy for user creation", async () => {
    const result = await createUserAccount({
      email: "person@example.com",
      password: "short",
      roleId: "HR-100",
      isSuperuser: false,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/at least 12 characters/i);
  });

  // BI-4150F4D6: the Admin createUserAccount path must sync a human Principal so
  // an owner/admin onboarded through Admin is not identity-incomplete.
  it("syncs a human Principal after creating a user account", async () => {
    mockPrisma.platformRole.findUnique.mockResolvedValue({ id: "role-db-1" });
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({ id: "new-user-id" });

    const result = await createUserAccount({
      email: "owner@example.com",
      password: "ValidPassword1!",
      roleId: "HR-100",
      isSuperuser: true,
    });

    expect(result.ok).toBe(true);
    expect(syncUserPrincipal).toHaveBeenCalledWith("new-user-id");
  });

  // A principal-sync failure must not fail the account creation.
  it("still creates the user when principal sync fails", async () => {
    mockPrisma.platformRole.findUnique.mockResolvedValue({ id: "role-db-1" });
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({ id: "new-user-id-2" });
    (syncUserPrincipal as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("boom"));

    const result = await createUserAccount({
      email: "owner2@example.com",
      password: "ValidPassword1!",
      roleId: "HR-100",
      isSuperuser: false,
    });

    expect(result.ok).toBe(true);
  });

  it("updates lifecycle when role exists and governance allows it", async () => {
    mockPrisma.platformRole.findUnique.mockResolvedValue({ id: "role-db-1" });
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "target-user",
      email: "worker@example.com",
      isSuperuser: false,
    });

    const result = await updateUserLifecycle({
      userId: "target-user",
      roleId: "HR-100",
      isActive: true,
    });

    expect(result.ok).toBe(true);
    expect(mockPrisma.$transaction).toHaveBeenCalledOnce();
  });

  describe("addUserPlatformRole", () => {
    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "user-1",
        isActive: true,
        isSuperuser: true,
        automationVerificationId: null,
        workHandedOverAt: null,
        groups: [{ platformRole: { roleId: "HR-000" } }],
      });
      mockPrisma.principalAlias.findUnique.mockResolvedValue({ principal: { kind: "human", status: "active" } });
      mockPrisma.platformRole.findUnique.mockResolvedValue({ id: "role-hr-200", name: "Digital Product Manager" });
      mockPrisma.userGroup.createMany.mockResolvedValue({ count: 1 });
    });

    it("adds HR-200 to the authorized human's own account and writes an audit in the transaction", async () => {
      const result = await addUserPlatformRole({ userId: "user-1", roleId: "HR-200" });
      expect(result).toMatchObject({ ok: true, data: { change: "added" } });
      expect(mockCan).toHaveBeenCalledWith(expect.objectContaining({ platformRoles: ["HR-000"] }), "manage_users");
      expect(mockPrisma.userGroup.createMany).toHaveBeenCalledExactlyOnceWith({
        data: { userId: "user-1", platformRoleId: "role-hr-200" }, skipDuplicates: true,
      });
      expect(mockPrisma.userGroup.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockCreateAuthorizationDecisionLog).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          actorType: "user", actorRef: "user-1", actionKey: "user.platform_role_add",
          objectRef: "user-1", decision: "allow", rationale: { roleId: "HR-200", effect: "added" },
        }),
        prisma,
      );
    });

    it("treats a duplicate as unchanged without a second grant receipt", async () => {
      mockPrisma.userGroup.createMany.mockResolvedValue({ count: 0 });
      expect(await addUserPlatformRole({ userId: "user-1", roleId: "HR-200" })).toMatchObject({ ok: true, data: { change: "unchanged" } });
      expect(mockCreateAuthorizationDecisionLog).not.toHaveBeenCalled();
    });

    it("does not trust a stale privileged session after live authority was removed", async () => {
      mockAuth.mockResolvedValue({ user: { ...authorizedSession.user, isSuperuser: true } });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "user-1", isActive: true, isSuperuser: false, automationVerificationId: null,
        workHandedOverAt: null, groups: [],
      });
      mockCan.mockReturnValue(false);
      expect(await addUserPlatformRole({ userId: "user-1", roleId: "HR-200" })).toMatchObject({ ok: false });
      expect(mockPrisma.userGroup.createMany).not.toHaveBeenCalled();
    });

    it("rejects automation identities even if the account has administrative role metadata", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "user-1", isActive: true, isSuperuser: true, automationVerificationId: "fixture",
        workHandedOverAt: null, groups: [{ platformRole: { roleId: "HR-000" } }],
      });
      expect(await addUserPlatformRole({ userId: "user-1", roleId: "HR-200" })).toMatchObject({ ok: false });
      expect(mockPrisma.userGroup.createMany).not.toHaveBeenCalled();
    });

    it("does not allow a non-superuser to change a superuser target", async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: "user-1", isActive: true, isSuperuser: false, automationVerificationId: null,
        workHandedOverAt: null, groups: [{ platformRole: { roleId: "HR-000" } }],
      }).mockResolvedValueOnce({ id: "target", isActive: true, isSuperuser: true });
      expect(await addUserPlatformRole({ userId: "target", roleId: "HR-200" })).toMatchObject({ ok: false });
      expect(mockPrisma.userGroup.createMany).not.toHaveBeenCalled();
    });

    it("does not report success or refresh on an audit error", async () => {
      mockCreateAuthorizationDecisionLog.mockRejectedValueOnce(new Error("audit unavailable"));
      expect(await addUserPlatformRole({ userId: "user-1", roleId: "HR-200" })).toMatchObject({ ok: false, error: expect.stringContaining("audit record") });
      const { revalidatePath } = await import("next/cache");
      expect(revalidatePath).not.toHaveBeenCalled();
    });
  });
});

describe("governed rehearsal requester guards (BI-9F7192F9 phase 8, AC-E7)", () => {
  const GOVERNED = "governed_rehearsal_requester";
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue(authorizedSession);
    mockCan.mockReturnValue(true);
    mockGetUserTeamIds.mockResolvedValue(["team-1"]);
    mockBuildPrincipalContext.mockReturnValue({ platformRoleIds: ["HR-300"] });
    mockResolveGovernedAction.mockReturnValue({ decision: "allow", rationaleCode: "ok" });
    mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma));
    mockPrisma.platformConfig.findUnique.mockResolvedValue(null);
    mockPrisma.platformRole.findUnique.mockResolvedValue({ id: "role-db-1" });
    mockPrisma.user.findUnique.mockResolvedValue({ id: "requester", email: "rehearsal-0123456789abcdef@s5-rehearsal.invalid", isActive: true, isSuperuser: false });
  });

  // The marker outlives retirement: an active and a retired enrollment both answer the same unique read.
  describe.each(["active", "retired"])("with an %s enrollment", (lifecycle) => {
    beforeEach(() => {
      mockPrisma.s5RehearsalRequesterEnrollment.findUnique.mockResolvedValue({ id: `enr-${lifecycle}` });
    });

    it("refuses lifecycle and role changes without writing", async () => {
      await expect(updateUserLifecycle({ userId: "requester", roleId: "HR-100", isActive: true }))
        .resolves.toEqual({ ok: false, message: GOVERNED });
      expect(await addUserPlatformRole({ userId: "requester", roleId: "HR-200" })).toMatchObject({ ok: false });
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockPrisma.userGroup.create).not.toHaveBeenCalled();
      expect(mockPrisma.userGroup.createMany).not.toHaveBeenCalled();
    });

    it("refuses admin reset and reset issue, and issues nothing", async () => {
      await expect(adminResetUserPassword({ userId: "requester", newPassword: "ValidPassword1!" }))
        .resolves.toEqual({ ok: false, message: GOVERNED });
      await expect(adminIssuePasswordReset({ userId: "requester" })).resolves.toEqual({ ok: false, message: GOVERNED });
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockPrisma.passwordResetToken.create).not.toHaveBeenCalled();
    });

    it("refuses to complete a reset, even with a token issued before enrollment", async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
        id: "old-token", expiresAt: new Date(Date.now() + 86_400_000), consumedAt: null,
        user: { id: "requester", email: "rehearsal-0123456789abcdef@s5-rehearsal.invalid", isActive: true },
      });
      await expect(completePasswordReset({ token: "raw", newPassword: "ValidPassword1!", confirmPassword: "ValidPassword1!" }))
        .resolves.toEqual({ ok: false, message: GOVERNED });
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockPrisma.passwordResetToken.update).not.toHaveBeenCalled();
    });

    it("keeps the reset request neutral and issues nothing", async () => {
      const result = await requestPasswordReset({ email: "rehearsal-0123456789abcdef@s5-rehearsal.invalid" });
      expect(result).toEqual({ ok: true, message: expect.stringContaining("If an account exists") });
      expect(mockPrisma.passwordResetToken.create).not.toHaveBeenCalled();
    });
  });

  it("fails closed when the marker cannot be read", async () => {
    mockPrisma.s5RehearsalRequesterEnrollment.findUnique.mockRejectedValue(new Error("db down"));
    await expect(updateUserLifecycle({ userId: "requester", roleId: "HR-100", isActive: true }))
      .resolves.toEqual({ ok: false, message: GOVERNED });
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });
});
