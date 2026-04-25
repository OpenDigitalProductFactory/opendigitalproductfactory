import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({
  can: vi.fn().mockReturnValue(true),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    deviceCodeSession: {
      create: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
    },
    credentialEntry: {
      upsert: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/integrate/github-oauth", () => ({
  requestDeviceCode: vi.fn(),
  pollAccessToken: vi.fn(),
}));

vi.mock("@/lib/actions/platform-dev-config", () => ({
  validateGitHubToken: vi.fn(),
}));

vi.mock("@/lib/credential-crypto", () => ({
  encryptSecret: vi.fn((plain: string) => `enc:${plain}`),
}));

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import {
  pollAccessToken,
  requestDeviceCode,
} from "@/lib/integrate/github-oauth";
import { validateGitHubToken } from "@/lib/actions/platform-dev-config";
import { disconnectGitHub, initiateDeviceFlow, pollDeviceFlow } from "./github-device-flow";

// Convenience helper: mock the auth() call shape — vitest's mocked() chain is
// type-noisy on the NextAuth type, so we cast through unknown once here.
function setAuth(value: unknown): void {
  (vi.mocked(auth) as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(
    value,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(can).mockReturnValue(true);
  setAuth({ user: { id: "user-1", platformRole: "admin", isSuperuser: false } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("initiateDeviceFlow", () => {
  it("returns { success: false, error: 'Not authenticated' } when no session", async () => {
    setAuth(null);
    const result = await initiateDeviceFlow();
    expect(result).toEqual({ success: false, error: "Not authenticated" });
    expect(prisma.deviceCodeSession.create).not.toHaveBeenCalled();
  });

  it("returns { success: false, error: 'Unauthorized' } when caller lacks manage_platform", async () => {
    vi.mocked(can).mockReturnValueOnce(false);
    const result = await initiateDeviceFlow();
    expect(result).toEqual({ success: false, error: "Unauthorized" });
    expect(prisma.deviceCodeSession.create).not.toHaveBeenCalled();
  });

  it("requests a device code, persists a session, and returns the user-visible fields", async () => {
    vi.mocked(requestDeviceCode).mockResolvedValueOnce({
      device_code: "dc_secret",
      user_code: "WDJB-MJHT",
      verification_uri: "https://github.com/login/device",
      expires_in: 900,
      interval: 5,
    });
    vi.mocked(prisma.deviceCodeSession.create).mockResolvedValueOnce({
      id: "sess-1",
      deviceCode: "dc_secret",
      userCode: "WDJB-MJHT",
      interval: 5,
      expiresAt: new Date(Date.now() + 900_000),
      createdAt: new Date(),
      createdBy: "user-1",
      consumed: false,
    });

    const result = await initiateDeviceFlow();

    expect(requestDeviceCode).toHaveBeenCalledWith("public_repo");
    expect(prisma.deviceCodeSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        deviceCode: "dc_secret",
        userCode: "WDJB-MJHT",
        interval: 5,
        createdBy: "user-1",
        consumed: false,
        expiresAt: expect.any(Date),
      }),
    });
    expect(result).toEqual({
      success: true,
      data: {
        sessionId: "sess-1",
        userCode: "WDJB-MJHT",
        verificationUri: "https://github.com/login/device",
        expiresIn: 900,
        interval: 5,
      },
    });
    // The raw device_code MUST NOT leak to the client.
    if (result.success) {
      expect(result.data).not.toHaveProperty("deviceCode");
      expect(result.data).not.toHaveProperty("device_code");
    }
  });

  it("returns { success: false } if requestDeviceCode throws", async () => {
    vi.mocked(requestDeviceCode).mockRejectedValueOnce(new Error("network down"));
    const result = await initiateDeviceFlow();
    expect(result).toEqual({ success: false, error: "network down" });
    expect(prisma.deviceCodeSession.create).not.toHaveBeenCalled();
  });
});

// Helper to build a fresh, unconsumed, owned-by-user-1 session record.
function freshSession(overrides: Partial<{
  id: string;
  deviceCode: string;
  expiresAt: Date;
  createdBy: string;
  consumed: boolean;
}> = {}) {
  return {
    id: "sess-1",
    deviceCode: "dc_secret",
    userCode: "WDJB-MJHT",
    interval: 5,
    expiresAt: new Date(Date.now() + 900_000),
    createdAt: new Date(),
    createdBy: "user-1",
    consumed: false,
    ...overrides,
  };
}

describe("pollDeviceFlow", () => {
  it("returns Not authenticated when no session", async () => {
    setAuth(null);
    const result = await pollDeviceFlow("sess-1");
    expect(result).toEqual({ status: "error", error: "Not authenticated" });
  });

  it("returns Unauthorized when caller lacks manage_platform", async () => {
    vi.mocked(can).mockReturnValueOnce(false);
    const result = await pollDeviceFlow("sess-1");
    expect(result).toEqual({ status: "error", error: "Unauthorized" });
  });

  it("returns 'Session not found or expired' when the row is missing", async () => {
    vi.mocked(prisma.deviceCodeSession.findUnique).mockResolvedValueOnce(null);
    const result = await pollDeviceFlow("sess-1");
    expect(result).toEqual({ status: "error", error: "Session not found or expired" });
  });

  it("rejects when the session belongs to a different user", async () => {
    vi.mocked(prisma.deviceCodeSession.findUnique).mockResolvedValueOnce(
      freshSession({ createdBy: "user-2" }),
    );
    const result = await pollDeviceFlow("sess-1");
    expect(result).toEqual({ status: "error", error: "Session does not belong to caller" });
    expect(pollAccessToken).not.toHaveBeenCalled();
  });

  it("rejects when the session is already consumed", async () => {
    vi.mocked(prisma.deviceCodeSession.findUnique).mockResolvedValueOnce(
      freshSession({ consumed: true }),
    );
    const result = await pollDeviceFlow("sess-1");
    expect(result).toEqual({ status: "error", error: "Session already consumed" });
    expect(pollAccessToken).not.toHaveBeenCalled();
  });

  it("deletes the row and returns 'Code expired' when expiresAt is past", async () => {
    vi.mocked(prisma.deviceCodeSession.findUnique).mockResolvedValueOnce(
      freshSession({ expiresAt: new Date(Date.now() - 60_000) }),
    );
    vi.mocked(prisma.deviceCodeSession.delete).mockResolvedValueOnce({} as never);

    const result = await pollDeviceFlow("sess-1");

    expect(result).toEqual({ status: "error", error: "Code expired, start over" });
    expect(prisma.deviceCodeSession.delete).toHaveBeenCalledWith({ where: { id: "sess-1" } });
    expect(pollAccessToken).not.toHaveBeenCalled();
  });

  it("returns { status: 'pending' } when GitHub says authorization_pending", async () => {
    vi.mocked(prisma.deviceCodeSession.findUnique).mockResolvedValueOnce(freshSession());
    vi.mocked(pollAccessToken).mockResolvedValueOnce({ status: "pending" });

    const result = await pollDeviceFlow("sess-1");

    expect(result).toEqual({ status: "pending" });
    expect(prisma.credentialEntry.upsert).not.toHaveBeenCalled();
  });

  it("returns { status: 'slow_down', interval } when GitHub says slow_down", async () => {
    vi.mocked(prisma.deviceCodeSession.findUnique).mockResolvedValueOnce(freshSession());
    vi.mocked(pollAccessToken).mockResolvedValueOnce({ status: "slow_down", interval: 12 });

    const result = await pollDeviceFlow("sess-1");

    expect(result).toEqual({ status: "slow_down", interval: 12 });
  });

  it("deletes the row and returns 'Code expired' when GitHub says expired_token", async () => {
    vi.mocked(prisma.deviceCodeSession.findUnique).mockResolvedValueOnce(freshSession());
    vi.mocked(pollAccessToken).mockResolvedValueOnce({ status: "expired" });
    vi.mocked(prisma.deviceCodeSession.delete).mockResolvedValueOnce({} as never);

    const result = await pollDeviceFlow("sess-1");

    expect(result).toEqual({ status: "error", error: "Code expired, start over" });
    expect(prisma.deviceCodeSession.delete).toHaveBeenCalled();
  });

  it("deletes the row and returns 'Authorization denied' when GitHub says access_denied", async () => {
    vi.mocked(prisma.deviceCodeSession.findUnique).mockResolvedValueOnce(freshSession());
    vi.mocked(pollAccessToken).mockResolvedValueOnce({ status: "denied" });
    vi.mocked(prisma.deviceCodeSession.delete).mockResolvedValueOnce({} as never);

    const result = await pollDeviceFlow("sess-1");

    expect(result).toEqual({ status: "error", error: "Authorization denied" });
    expect(prisma.deviceCodeSession.delete).toHaveBeenCalled();
  });

  it("propagates poll-layer error messages", async () => {
    vi.mocked(prisma.deviceCodeSession.findUnique).mockResolvedValueOnce(freshSession());
    vi.mocked(pollAccessToken).mockResolvedValueOnce({ status: "error", error: "GitHub returned 502" });

    const result = await pollDeviceFlow("sess-1");

    expect(result).toEqual({ status: "error", error: "GitHub returned 502" });
    expect(prisma.deviceCodeSession.delete).not.toHaveBeenCalled();
  });

  it("on success: validates token, encrypts, upserts CredentialEntry, marks session consumed", async () => {
    vi.mocked(prisma.deviceCodeSession.findUnique).mockResolvedValueOnce(freshSession());
    vi.mocked(pollAccessToken).mockResolvedValueOnce({
      status: "success",
      token: "gho_xxx",
      scope: "public_repo",
    });
    vi.mocked(validateGitHubToken).mockResolvedValueOnce({
      valid: true,
      username: "jane-dev",
      authMethod: "oauth-device",
      scope: undefined,
      expiresAt: null,
    });
    vi.mocked(prisma.credentialEntry.upsert).mockResolvedValueOnce({} as never);
    vi.mocked(prisma.deviceCodeSession.update).mockResolvedValueOnce({} as never);

    const result = await pollDeviceFlow("sess-1");

    expect(validateGitHubToken).toHaveBeenCalledWith({
      token: "gho_xxx",
      requiredScope: "public_repo",
      authMethod: "oauth-device",
    });
    expect(prisma.credentialEntry.upsert).toHaveBeenCalledWith({
      where: { providerId: "hive-contribution" },
      create: expect.objectContaining({
        providerId: "hive-contribution",
        secretRef: "enc:gho_xxx",
        status: "active",
        scope: "public_repo",
      }),
      update: expect.objectContaining({
        secretRef: "enc:gho_xxx",
        status: "active",
        scope: "public_repo",
        tokenExpiresAt: null,
      }),
    });
    expect(prisma.deviceCodeSession.update).toHaveBeenCalledWith({
      where: { id: "sess-1" },
      data: { consumed: true },
    });
    expect(result).toEqual({ status: "success", username: "jane-dev" });
  });

  it("on success but scope-inadequate: surfaces validator error, does NOT upsert credential or consume session", async () => {
    vi.mocked(prisma.deviceCodeSession.findUnique).mockResolvedValueOnce(freshSession());
    vi.mocked(pollAccessToken).mockResolvedValueOnce({
      status: "success",
      token: "gho_xxx",
      scope: "",
    });
    vi.mocked(validateGitHubToken).mockResolvedValueOnce({
      valid: false,
      error: "Token is missing required scope 'public_repo'.",
    });

    const result = await pollDeviceFlow("sess-1");

    expect(result).toEqual({
      status: "error",
      error: "Token is missing required scope 'public_repo'.",
    });
    expect(prisma.credentialEntry.upsert).not.toHaveBeenCalled();
    expect(prisma.deviceCodeSession.update).not.toHaveBeenCalled();
  });
});

describe("disconnectGitHub", () => {
  it("returns Not authenticated when no session", async () => {
    setAuth(null);
    const result = await disconnectGitHub();
    expect(result).toEqual({ success: false, error: "Not authenticated" });
    expect(prisma.credentialEntry.updateMany).not.toHaveBeenCalled();
  });

  it("returns Unauthorized when caller lacks manage_platform", async () => {
    vi.mocked(can).mockReturnValueOnce(false);
    const result = await disconnectGitHub();
    expect(result).toEqual({ success: false, error: "Unauthorized" });
    expect(prisma.credentialEntry.updateMany).not.toHaveBeenCalled();
  });

  it("clears the hive-contribution credential and returns success", async () => {
    vi.mocked(prisma.credentialEntry.updateMany).mockResolvedValueOnce({ count: 1 });

    const result = await disconnectGitHub();

    expect(prisma.credentialEntry.updateMany).toHaveBeenCalledWith({
      where: { providerId: "hive-contribution" },
      data: {
        secretRef: null,
        status: "unconfigured",
        scope: null,
        tokenExpiresAt: null,
        cachedToken: null,
      },
    });
    expect(result).toEqual({ success: true });
  });

  it("succeeds quietly when the credential row does not exist", async () => {
    // updateMany on a non-existent row resolves with count: 0 — no throw.
    vi.mocked(prisma.credentialEntry.updateMany).mockResolvedValueOnce({ count: 0 });

    const result = await disconnectGitHub();

    expect(result).toEqual({ success: true });
  });
});
