import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies before importing
vi.mock("@dpf/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("../jwt.js", () => ({
  verifyAccessToken: vi.fn(),
}));

vi.mock("../../auth.js", () => ({
  auth: vi.fn(),
}));

vi.mock("../../permissions.js", () => ({
  getGrantedCapabilities: vi.fn(),
}));

import { prisma } from "@dpf/db";
import { verifyAccessToken } from "../jwt.js";
import { auth } from "../../auth.js";
import { getGrantedCapabilities } from "../../permissions.js";
import { authenticateRequest, requireCapability } from "../auth-middleware.js";
import { ApiError } from "../error.js";

beforeEach(() => {
  vi.clearAllMocks();
});

// Helper to create a mock NextRequest
function mockRequest(headers: Record<string, string> = {}): Request {
  return {
    headers: {
      get(name: string) {
        return headers[name.toLowerCase()] ?? null;
      },
    },
  } as unknown as Request;
}

// ---------------------------------------------------------------------------
// authenticateRequest — Bearer token path
// ---------------------------------------------------------------------------
describe("authenticateRequest — Bearer token", () => {
  it("extracts Bearer token and returns user + capabilities", async () => {
    const mockVerify = verifyAccessToken as ReturnType<typeof vi.fn>;
    mockVerify.mockResolvedValue({
      sub: "user-1",
      email: "alice@example.com",
      platformRole: "HR-000",
      isSuperuser: false,
    });

    const mockFindUnique = prisma.user.findUnique as ReturnType<typeof vi.fn>;
    mockFindUnique.mockResolvedValue({
      id: "user-1",
      email: "alice@example.com",
      isActive: true,
      isSuperuser: false,
      groups: [{ platformRole: { roleId: "HR-000" } }],
      employeeProfile: {
        id: "emp-1",
        directReports: [{ id: "emp-2" }],
      },
    });

    const mockCapabilities = getGrantedCapabilities as ReturnType<typeof vi.fn>;
    mockCapabilities.mockReturnValue(["view_admin", "view_portfolio"]);

    const req = mockRequest({ authorization: "Bearer my-jwt-token" });
    const result = await authenticateRequest(req as never);

    expect(mockVerify).toHaveBeenCalledWith("my-jwt-token");
    expect(result.user.id).toBe("user-1");
    expect(result.user.email).toBe("alice@example.com");
    expect(result.capabilities).toEqual(["view_admin", "view_portfolio"]);
    expect(result.authContext.principalId).toBe("PRN-USER-user-1");
    expect(result.authContext.employeeId).toBe("emp-1");
    expect(result.authContext.managerScope?.directReportIds).toEqual(["emp-2"]);
  });

  it("throws 401 if Bearer token is invalid", async () => {
    const mockVerify = verifyAccessToken as ReturnType<typeof vi.fn>;
    mockVerify.mockRejectedValue(new Error("Invalid token"));

    const req = mockRequest({ authorization: "Bearer bad-token" });

    try {
      await authenticateRequest(req as never);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(401);
    }
  });
});

// ---------------------------------------------------------------------------
// authenticateRequest — Session fallback
// ---------------------------------------------------------------------------
describe("authenticateRequest — session fallback", () => {
  it("falls back to NextAuth session when no Bearer header", async () => {
    const mockAuth = auth as ReturnType<typeof vi.fn>;
    mockAuth.mockResolvedValue({
      user: {
        id: "user-2",
        email: "bob@example.com",
        type: "admin",
        platformRole: "HR-300",
        isSuperuser: false,
        accountId: null,
        accountName: null,
        contactId: null,
      },
    });

    const mockCapabilities = getGrantedCapabilities as ReturnType<typeof vi.fn>;
    mockCapabilities.mockReturnValue(["view_ea_modeler"]);

    const req = mockRequest({});
    const result = await authenticateRequest(req as never);

    expect(result.user.id).toBe("user-2");
    expect(result.user.email).toBe("bob@example.com");
    expect(result.capabilities).toEqual(["view_ea_modeler"]);
    expect(result.authContext.principalId).toBe("PRN-USER-user-2");
    expect(result.authContext.employeeId).toBeNull();
    expect(result.authContext.managerScope).toBeNull();
  });

  it("throws 401 when no Bearer token and no session", async () => {
    const mockAuth = auth as ReturnType<typeof vi.fn>;
    mockAuth.mockResolvedValue(null);

    const req = mockRequest({});

    try {
      await authenticateRequest(req as never);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(401);
    }
  });
});

// ---------------------------------------------------------------------------
// requireCapability
// ---------------------------------------------------------------------------
describe("requireCapability", () => {
  it("does not throw when capability is present", () => {
    expect(() =>
      requireCapability(["view_admin", "view_portfolio"], "view_admin"),
    ).not.toThrow();
  });

  it("throws 403 ApiError when capability is missing", () => {
    try {
      requireCapability(["view_portfolio"], "view_admin");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(403);
      expect((e as ApiError).code).toBe("FORBIDDEN");
    }
  });
});
