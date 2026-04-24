import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing route handlers
// ---------------------------------------------------------------------------

vi.mock("@dpf/db", () => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn() },
    apiToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("bcryptjs", () => ({
  default: { compare: vi.fn(), hash: vi.fn() },
}));

vi.mock("../../api/jwt.js", () => ({
  signAccessToken: vi.fn(),
  createRefreshToken: vi.fn(),
  rotateRefreshToken: vi.fn(),
  revokeRefreshToken: vi.fn(),
}));

vi.mock("../../api/auth-middleware.js", () => ({
  authenticateRequest: vi.fn(),
}));

vi.mock("../../permissions.js", () => ({
  getGrantedCapabilities: vi.fn(),
}));

// Mock @dpf/validators with lightweight schema-like objects.
// safeParse returns success/failure matching zod's interface.
vi.mock("@dpf/validators", () => {
  function makeSchema(validator: (data: unknown) => string | null) {
    return {
      safeParse(data: unknown) {
        const err = validator(data);
        if (err) return { success: false as const, error: { flatten: () => err } };
        return { success: true as const, data };
      },
    };
  }
  return {
    loginSchema: makeSchema((data: unknown) => {
      const d = data as Record<string, unknown>;
      if (!d || typeof d.email !== "string" || !d.email.includes("@")) return "invalid email";
      if (!d.password || typeof d.password !== "string") return "password required";
      return null;
    }),
    refreshSchema: makeSchema((data: unknown) => {
      const d = data as Record<string, unknown>;
      if (!d || typeof d.refreshToken !== "string" || d.refreshToken.length === 0) return "refreshToken required";
      return null;
    }),
  };
});

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { prisma } from "@dpf/db";
import bcrypt from "bcryptjs";
import {
  signAccessToken,
  createRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
} from "../../api/jwt.js";
import { authenticateRequest } from "../../api/auth-middleware.js";
import { getGrantedCapabilities } from "../../permissions.js";

// Route handlers — imported dynamically per test to get fresh modules
import { POST as loginHandler } from "../../../app/api/v1/auth/login/route.js";
import { POST as refreshHandler } from "../../../app/api/v1/auth/refresh/route.js";
import { POST as logoutHandler } from "../../../app/api/v1/auth/logout/route.js";
import { GET as meHandler } from "../../../app/api/v1/auth/me/route.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function getRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/v1/auth/me", {
    method: "GET",
    headers,
  });
}

// Shared mock user
const MOCK_USER = {
  id: "user-1",
  email: "alice@example.com",
  passwordHash: "$2a$12$hashedpassword",
  isActive: true,
  isSuperuser: false,
  groups: [{ platformRole: { roleId: "HR-000" } }],
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// LOGIN
// ===========================================================================
describe("POST /api/v1/auth/login", () => {
  it("returns tokens on successful login", async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_USER);
    (bcrypt.compare as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (signAccessToken as ReturnType<typeof vi.fn>).mockResolvedValue("jwt-access-token");
    (createRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValue("refresh-token-abc");

    const req = jsonRequest({ email: "alice@example.com", password: "secret123" });
    const res = await loginHandler(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.accessToken).toBe("jwt-access-token");
    expect(body.refreshToken).toBe("refresh-token-abc");
    expect(body.expiresIn).toBe(900);

    expect(signAccessToken).toHaveBeenCalledWith({
      sub: "user-1",
      email: "alice@example.com",
      platformRole: "HR-000",
      isSuperuser: false,
    });
    expect(createRefreshToken).toHaveBeenCalledWith("user-1");
  });

  it("returns 401 on wrong password", async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_USER);
    (bcrypt.compare as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const req = jsonRequest({ email: "alice@example.com", password: "wrongpass" });
    const res = await loginHandler(req);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.code).toBe("INVALID_CREDENTIALS");
  });

  it("returns 401 when user not found", async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const req = jsonRequest({ email: "nobody@example.com", password: "secret123" });
    const res = await loginHandler(req);

    expect(res.status).toBe(401);
  });

  it("accepts a legacy sha256 password and rehashes on success", async () => {
    const legacySha256 =
      "fcf730b6d95236ecd3c9fc2d92d7b6b2bb061514961aec041d6c7a7192f592e4";
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...MOCK_USER,
      passwordHash: legacySha256,
    });
    (bcrypt.compare as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (bcrypt.hash as ReturnType<typeof vi.fn>).mockResolvedValue("$2a$12$rehash");
    (prisma.user.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...MOCK_USER,
      passwordHash: "$2a$12$rehash",
    });
    (signAccessToken as ReturnType<typeof vi.fn>).mockResolvedValue("jwt-access-token");
    (createRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValue("refresh-token-abc");

    const req = jsonRequest({ email: "alice@example.com", password: "secret123" });
    const res = await loginHandler(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.accessToken).toBe("jwt-access-token");
    expect(body.refreshToken).toBe("refresh-token-abc");
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { passwordHash: "$2a$12$rehash" },
    });
  });

  it("returns 403 for inactive user", async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...MOCK_USER,
      isActive: false,
    });
    (bcrypt.compare as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const req = jsonRequest({ email: "alice@example.com", password: "secret123" });
    const res = await loginHandler(req);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.code).toBe("ACCOUNT_INACTIVE");
  });

  it("returns 403 when user has no UserGroup", async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...MOCK_USER,
      groups: [],
    });
    (bcrypt.compare as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const req = jsonRequest({ email: "alice@example.com", password: "secret123" });
    const res = await loginHandler(req);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.code).toBe("NO_WORKFORCE_GROUP");
  });

  it("returns 400 for invalid email format", async () => {
    const req = jsonRequest({ email: "not-an-email", password: "secret123" });
    const res = await loginHandler(req);

    expect(res.status).toBe(400);
  });

  it("returns 400 for missing password", async () => {
    const req = jsonRequest({ email: "alice@example.com" });
    const res = await loginHandler(req);

    expect(res.status).toBe(400);
  });
});

// ===========================================================================
// REFRESH
// ===========================================================================
describe("POST /api/v1/auth/refresh", () => {
  it("returns new tokens on valid refresh", async () => {
    const newToken = "new-refresh-token";
    (rotateRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValue(newToken);
    (prisma.apiToken.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "tok-new",
      token: newToken,
      userId: "user-1",
      name: "mobile-refresh",
      expiresAt: new Date(Date.now() + 86400000),
    });
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_USER);
    (signAccessToken as ReturnType<typeof vi.fn>).mockResolvedValue("new-jwt");

    const req = jsonRequest({ refreshToken: "old-refresh-token" });
    const res = await refreshHandler(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.accessToken).toBe("new-jwt");
    expect(body.refreshToken).toBe(newToken);
    expect(body.expiresIn).toBe(900);
  });

  it("returns 401 for invalid refresh token", async () => {
    (rotateRefreshToken as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Refresh token not found"),
    );

    const req = jsonRequest({ refreshToken: "bad-token" });
    const res = await refreshHandler(req);

    expect(res.status).toBe(401);
  });

  it("returns 401 for expired refresh token", async () => {
    (rotateRefreshToken as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Refresh token expired"),
    );

    const req = jsonRequest({ refreshToken: "expired-token" });
    const res = await refreshHandler(req);

    expect(res.status).toBe(401);
  });
});

// ===========================================================================
// ME
// ===========================================================================
describe("GET /api/v1/auth/me", () => {
  it("returns user profile when authenticated", async () => {
    const mockUser = {
      id: "user-1",
      email: "alice@example.com",
      type: "admin" as const,
      platformRole: "HR-000",
      isSuperuser: false,
      accountId: null,
      accountName: null,
      contactId: null,
    };
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: mockUser,
      capabilities: ["view_admin", "view_portfolio"],
    });

    const req = getRequest({ authorization: "Bearer valid-jwt" });
    const res = await meHandler(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe("user-1");
    expect(body.email).toBe("alice@example.com");
    expect(body.platformRole).toBe("HR-000");
    expect(body.isSuperuser).toBe(false);
    expect(body.capabilities).toEqual(["view_admin", "view_portfolio"]);
  });

  it("returns 401 when not authenticated", async () => {
    const { ApiError } = await import("../../api/error.js");
    (authenticateRequest as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError("UNAUTHENTICATED", "Authentication required", 401),
    );

    const req = getRequest();
    const res = await meHandler(req);

    expect(res.status).toBe(401);
  });
});

// ===========================================================================
// LOGOUT
// ===========================================================================
describe("POST /api/v1/auth/logout", () => {
  it("returns 204 on successful logout", async () => {
    const mockUser = {
      id: "user-1",
      email: "alice@example.com",
      type: "admin" as const,
      platformRole: "HR-000",
      isSuperuser: false,
      accountId: null,
      accountName: null,
      contactId: null,
    };
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: mockUser,
      capabilities: ["view_admin"],
    });
    (revokeRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const req = jsonRequest(
      { refreshToken: "token-to-revoke" },
      { authorization: "Bearer valid-jwt" },
    );
    const res = await logoutHandler(req);

    expect(res.status).toBe(204);
    expect(revokeRefreshToken).toHaveBeenCalledWith("token-to-revoke");
  });

  it("returns 204 even if no refresh token in body (revokes all for user)", async () => {
    const mockUser = {
      id: "user-1",
      email: "alice@example.com",
      type: "admin" as const,
      platformRole: "HR-000",
      isSuperuser: false,
      accountId: null,
      accountName: null,
      contactId: null,
    };
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: mockUser,
      capabilities: ["view_admin"],
    });
    (prisma.apiToken.deleteMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 2 });

    const req = jsonRequest({}, { authorization: "Bearer valid-jwt" });
    const res = await logoutHandler(req);

    expect(res.status).toBe(204);
    expect(prisma.apiToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", name: "mobile-refresh" },
    });
  });
});
