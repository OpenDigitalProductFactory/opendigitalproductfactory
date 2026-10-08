import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAuth,
  mockCan,
  mockCreateOAuthFlow,
  mockPrisma,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockCan: vi.fn(),
  mockCreateOAuthFlow: vi.fn(),
  mockPrisma: {
    aiProviderConnection: { findUnique: vi.fn(), update: vi.fn() },
    oAuthPendingFlow: { deleteMany: vi.fn() },
    $transaction: vi.fn(),
    credentialEntry: {
      upsert: vi.fn(),
      update: vi.fn(),
    },
    mcpServer: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    modelProvider: {
      updateMany: vi.fn(),
    },
  },
}));

const callback = vi.hoisted(() => ({ findPendingOAuthContext: vi.fn(), exchangeOAuthCode: vi.fn() }));
vi.mock("@/lib/portal-url", () => ({ getPortalUrl: async () => "https://portal.example.test" }));

vi.mock("@/lib/auth", () => ({
  auth: mockAuth,
}));

vi.mock("@/lib/permissions", () => ({
  can: mockCan,
}));

vi.mock("@/lib/provider-oauth", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/provider-oauth")>(),
  createOAuthFlow: mockCreateOAuthFlow,
  ...callback,
}));

vi.mock("@dpf/db", () => ({
  prisma: mockPrisma,
}));

import { disconnectProviderOAuth, startProviderOAuth } from "./provider-oauth";
import { GET as oauthCallback } from "@/app/api/v1/auth/provider-oauth/callback/route";
import { NextRequest } from "next/server";

describe("provider-oauth actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({
      user: {
        id: "user-1",
        platformRole: "HR-000",
        isSuperuser: true,
      },
    });
    mockCan.mockReturnValue(true);
    mockCreateOAuthFlow.mockResolvedValue({
      authorizeUrl: "https://auth.example.com/oauth/authorize?state=abc",
    });
    mockPrisma.credentialEntry.upsert.mockResolvedValue({});
    mockPrisma.mcpServer.findMany.mockResolvedValue([]);
    mockPrisma.modelProvider.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.$transaction.mockImplementation((fn) => fn(mockPrisma));
  });

  it("returns both success and denied-consent callbacks to the selected account", async () => {
    callback.findPendingOAuthContext.mockResolvedValue({ providerId: "codex", connectionId: "account-b" });
    callback.exchangeOAuthCode.mockResolvedValue({ providerId: "codex", connectionId: "account-b" });
    const success = await oauthCallback(new NextRequest("https://portal.example.test/api/v1/auth/provider-oauth/callback?state=state-b&code=code-b"));
    expect(success.headers.get("location")).toBe("https://portal.example.test/platform/ai/providers/codex?oauth=success&account=account-b");
    const denied = await oauthCallback(new NextRequest("https://portal.example.test/api/v1/auth/provider-oauth/callback?state=state-b&error=access_denied"));
    const location = new URL(denied.headers.get("location")!);
    expect(location.pathname).toBe("/platform/ai/providers/codex");
    expect(location.searchParams.get("account")).toBe("account-b");
    expect(callback.exchangeOAuthCode).toHaveBeenCalledTimes(1);
  });

  it("refuses callbacks before reading sign-in state when provider management is forbidden", async () => {
    mockCan.mockReturnValue(false);
    const response = await oauthCallback(new NextRequest("https://portal.example.test/api/v1/auth/provider-oauth/callback?state=state-b&code=code-b"));
    expect(response.headers.get("location")).toBe("https://portal.example.test/login?error=unauthorized");
    expect(callback.findPendingOAuthContext).not.toHaveBeenCalled();
    expect(callback.exchangeOAuthCode).not.toHaveBeenCalled();
  });

  it("starts OAuth when the admin session is valid", async () => {
    const result = await startProviderOAuth("codex");

    expect(result).toEqual({
      authorizeUrl: "https://auth.example.com/oauth/authorize?state=abc",
    });
    expect(mockCreateOAuthFlow).toHaveBeenCalledWith("codex");
  });

  it("starts sign-in for the selected account", async () => {
    await startProviderOAuth("codex", "account-b");
    expect(mockCreateOAuthFlow).toHaveBeenCalledWith("codex", "account-b");
  });

  it("disconnects only the selected account without deactivating provider-wide services", async () => {
    mockPrisma.aiProviderConnection.findUnique.mockResolvedValue({ providerId: "codex", credentialEntryId: "credential-b" });
    expect(await disconnectProviderOAuth("codex", "account-b")).toEqual({});
    expect(mockPrisma.credentialEntry.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "credential-b" }, data: expect.objectContaining({ cachedToken: null, refreshToken: null }) }));
    expect(mockPrisma.aiProviderConnection.update).toHaveBeenCalledWith({ where: { connectionId: "account-b" }, data: { status: "disconnected" } });
    expect(mockPrisma.credentialEntry.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.mcpServer.findMany).not.toHaveBeenCalled();
  });

  it("returns a reconnect error instead of throwing when the admin session is stale", async () => {
    mockAuth.mockResolvedValue(null);

    const result = await startProviderOAuth("codex");

    expect(result).toEqual({
      error: "Your admin session expired — sign in again and retry OAuth setup",
    });
  });

  it("returns a reconnect error when disconnect is attempted with a stale session", async () => {
    mockAuth.mockResolvedValue(null);

    const result = await disconnectProviderOAuth("codex");

    expect(result).toEqual({
      error: "Your admin session expired — sign in again before disconnecting this provider",
    });
    expect(mockPrisma.credentialEntry.upsert).not.toHaveBeenCalled();
  });
});
