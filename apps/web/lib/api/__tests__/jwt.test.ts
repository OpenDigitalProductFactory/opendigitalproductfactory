import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";

// Mock @dpf/db before importing modules that use it
vi.mock("@dpf/db", () => ({
  prisma: {
    apiToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";
import {
  signAccessToken,
  verifyAccessToken,
  createRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
} from "../jwt.js";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUTH_SECRET = "test-secret-key-that-is-long-enough-for-hmac-256";
});

// ---------------------------------------------------------------------------
// signAccessToken / verifyAccessToken round-trip
// ---------------------------------------------------------------------------
describe("signAccessToken / verifyAccessToken", () => {
  it("signs and verifies a token round-trip", async () => {
    const payload = {
      sub: "user-1",
      email: "alice@example.com",
      platformRole: "HR-000" as const,
      isSuperuser: false,
    };
    const token = await signAccessToken(payload);
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(3); // JWT has 3 parts

    const decoded = await verifyAccessToken(token);
    expect(decoded.sub).toBe("user-1");
    expect(decoded.email).toBe("alice@example.com");
    expect(decoded.platformRole).toBe("HR-000");
    expect(decoded.isSuperuser).toBe(false);
  });

  it("rejects an expired token", async () => {
    // Create a token that expired 1 second ago using jose directly
    const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
    const expiredToken = await new SignJWT({
      email: "bob@example.com",
      platformRole: null,
      isSuperuser: false,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-2")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 120) // issued 2 minutes ago
      .setExpirationTime(Math.floor(Date.now() / 1000) - 1) // expired 1 second ago
      .sign(secret);

    await expect(verifyAccessToken(expiredToken)).rejects.toThrow();
  });

  it("rejects a tampered token", async () => {
    const payload = {
      sub: "user-3",
      email: "charlie@example.com",
      platformRole: "HR-300" as const,
      isSuperuser: false,
    };
    const token = await signAccessToken(payload);
    // Tamper with the payload section
    const parts = token.split(".");
    parts[1] = parts[1] + "tampered";
    const tampered = parts.join(".");

    await expect(verifyAccessToken(tampered)).rejects.toThrow();
  });

  it("rejects a token signed with a different secret", async () => {
    const payload = {
      sub: "user-4",
      email: "dave@example.com",
      platformRole: null,
      isSuperuser: true,
    };
    const token = await signAccessToken(payload);

    // Change the secret for verification
    process.env.AUTH_SECRET = "different-secret-key-that-is-long-enough-too";
    await expect(verifyAccessToken(token)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// createRefreshToken
// ---------------------------------------------------------------------------
describe("createRefreshToken", () => {
  it("creates an ApiToken record and returns the token string", async () => {
    const mockCreate = prisma.apiToken.create as ReturnType<typeof vi.fn>;
    mockCreate.mockResolvedValue({
      id: "tok-1",
      token: "abc123",
      userId: "user-1",
      name: "mobile-refresh",
      expiresAt: new Date(),
      createdAt: new Date(),
    });

    const token = await createRefreshToken("user-1");

    expect(typeof token).toBe("string");
    expect(token.length).toBe(128); // 64 bytes = 128 hex chars
    expect(mockCreate).toHaveBeenCalledOnce();
    const createArg = mockCreate.mock.calls[0][0];
    expect(createArg.data.userId).toBe("user-1");
    expect(createArg.data.name).toBe("mobile-refresh");
    expect(createArg.data.token).toBe(token);
    // Expiry should be ~30 days from now
    const expiresAt = createArg.data.expiresAt as Date;
    const diffDays = (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThan(29);
    expect(diffDays).toBeLessThan(31);
  });
});

// ---------------------------------------------------------------------------
// rotateRefreshToken
// ---------------------------------------------------------------------------
describe("rotateRefreshToken", () => {
  it("finds, deletes old token, creates new one", async () => {
    const mockFindUnique = prisma.apiToken.findUnique as ReturnType<typeof vi.fn>;
    const mockDelete = prisma.apiToken.delete as ReturnType<typeof vi.fn>;
    const mockCreate = prisma.apiToken.create as ReturnType<typeof vi.fn>;

    mockFindUnique.mockResolvedValue({
      id: "tok-old",
      token: "old-token-value",
      userId: "user-1",
      name: "mobile-refresh",
      expiresAt: new Date(Date.now() + 86400000), // not expired
      createdAt: new Date(),
    });
    mockDelete.mockResolvedValue({});
    mockCreate.mockResolvedValue({
      id: "tok-new",
      token: "new-token-value",
      userId: "user-1",
      name: "mobile-refresh",
      expiresAt: new Date(),
      createdAt: new Date(),
    });

    const newToken = await rotateRefreshToken("old-token-value");
    expect(typeof newToken).toBe("string");
    expect(newToken.length).toBe(128);
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { token: "old-token-value" } });
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: "tok-old" } });
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("throws if old token not found", async () => {
    const mockFindUnique = prisma.apiToken.findUnique as ReturnType<typeof vi.fn>;
    mockFindUnique.mockResolvedValue(null);

    await expect(rotateRefreshToken("nonexistent")).rejects.toThrow();
  });

  it("throws if old token is expired", async () => {
    const mockFindUnique = prisma.apiToken.findUnique as ReturnType<typeof vi.fn>;
    mockFindUnique.mockResolvedValue({
      id: "tok-expired",
      token: "expired-token",
      userId: "user-1",
      name: "mobile-refresh",
      expiresAt: new Date(Date.now() - 86400000), // expired yesterday
      createdAt: new Date(),
    });

    await expect(rotateRefreshToken("expired-token")).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// revokeRefreshToken
// ---------------------------------------------------------------------------
describe("revokeRefreshToken", () => {
  it("deletes the ApiToken by token value", async () => {
    const mockDelete = prisma.apiToken.delete as ReturnType<typeof vi.fn>;
    mockDelete.mockResolvedValue({});

    await revokeRefreshToken("some-token");
    expect(mockDelete).toHaveBeenCalledWith({ where: { token: "some-token" } });
  });
});
