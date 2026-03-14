import { beforeEach, describe, expect, it, vi } from "vitest";

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
    },
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

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getUserTeamIds, createAuthorizationDecisionLog } from "@/lib/governance-data";
import { buildPrincipalContext } from "@/lib/principal-context";
import { resolveGovernedAction } from "@/lib/governance-resolver";
import { prisma } from "@dpf/db";
import {
  adminIssuePasswordReset,
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
});
