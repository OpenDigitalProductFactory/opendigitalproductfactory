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
    credentialEntry: {
      upsert: vi.fn(),
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

vi.mock("@/lib/auth", () => ({
  auth: mockAuth,
}));

vi.mock("@/lib/permissions", () => ({
  can: mockCan,
}));

vi.mock("@/lib/provider-oauth", () => ({
  createOAuthFlow: mockCreateOAuthFlow,
}));

vi.mock("@dpf/db", () => ({
  prisma: mockPrisma,
}));

import { disconnectProviderOAuth, startProviderOAuth } from "./provider-oauth";

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
  });

  it("starts OAuth when the admin session is valid", async () => {
    const result = await startProviderOAuth("codex");

    expect(result).toEqual({
      authorizeUrl: "https://auth.example.com/oauth/authorize?state=abc",
    });
    expect(mockCreateOAuthFlow).toHaveBeenCalledWith("codex");
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
