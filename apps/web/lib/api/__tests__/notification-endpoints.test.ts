import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@dpf/db", () => ({
  prisma: {
    notification: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    pushDeviceRegistration: { upsert: vi.fn() },
  },
}));

vi.mock("../../api/auth-middleware.js", () => ({
  authenticateRequest: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { prisma } from "@dpf/db";
import { authenticateRequest } from "../../api/auth-middleware.js";

import { GET as notificationsListHandler } from "../../../app/api/v1/notifications/route.js";
import { PATCH as markReadHandler } from "../../../app/api/v1/notifications/[id]/read/route.js";
import { POST as registerDeviceHandler } from "../../../app/api/v1/notifications/register-device/route.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_AUTH = {
  user: {
    id: "user-1",
    email: "alice@example.com",
    type: "admin" as const,
    platformRole: "HR-000",
    isSuperuser: false,
    accountId: null,
    accountName: null,
    contactId: null,
  },
  capabilities: ["view_admin"],
};

function getRequest(path: string): Request {
  return new Request(`http://localhost${path}`, {
    method: "GET",
    headers: { authorization: "Bearer valid-jwt" },
  });
}

function postRequest(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { authorization: "Bearer valid-jwt", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patchRequest(path: string): Request {
  return new Request(`http://localhost${path}`, {
    method: "PATCH",
    headers: { authorization: "Bearer valid-jwt" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// NOTIFICATIONS FEED
// ===========================================================================
describe("GET /api/v1/notifications", () => {
  it("returns paginated notifications for the user", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
    (prisma.notification.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "notif-1",
        userId: "user-1",
        type: "approval_request",
        title: "New approval needed",
        body: null,
        deepLink: null,
        read: false,
        createdAt: new Date(),
      },
    ]);

    const res = await notificationsListHandler(getRequest("/api/v1/notifications"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.length).toBe(1);
    expect(body.data[0].title).toBe("New approval needed");
  });

  it("returns 401 when unauthenticated", async () => {
    const { ApiError } = await import("../../api/error.js");
    (authenticateRequest as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError("UNAUTHENTICATED", "Authentication required", 401),
    );

    const res = await notificationsListHandler(getRequest("/api/v1/notifications"));
    expect(res.status).toBe(401);
  });
});

// ===========================================================================
// MARK READ
// ===========================================================================
describe("PATCH /api/v1/notifications/:id/read", () => {
  it("marks a notification as read", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
    (prisma.notification.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "notif-1",
      userId: "user-1",
    });
    (prisma.notification.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "notif-1",
      userId: "user-1",
      read: true,
    });

    const res = await markReadHandler(
      patchRequest("/api/v1/notifications/notif-1/read"),
      { params: Promise.resolve({ id: "notif-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.read).toBe(true);
  });

  it("returns 404 when notification not found", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
    (prisma.notification.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await markReadHandler(
      patchRequest("/api/v1/notifications/nonexistent/read"),
      { params: Promise.resolve({ id: "nonexistent" }) },
    );

    expect(res.status).toBe(404);
  });

  it("returns 404 when notification belongs to another user", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
    (prisma.notification.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "notif-1",
      userId: "other-user",
    });

    const res = await markReadHandler(
      patchRequest("/api/v1/notifications/notif-1/read"),
      { params: Promise.resolve({ id: "notif-1" }) },
    );

    expect(res.status).toBe(404);
  });

  it("returns 401 when unauthenticated", async () => {
    const { ApiError } = await import("../../api/error.js");
    (authenticateRequest as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError("UNAUTHENTICATED", "Authentication required", 401),
    );

    const res = await markReadHandler(
      patchRequest("/api/v1/notifications/notif-1/read"),
      { params: Promise.resolve({ id: "notif-1" }) },
    );

    expect(res.status).toBe(401);
  });
});

// ===========================================================================
// REGISTER DEVICE
// ===========================================================================
describe("POST /api/v1/notifications/register-device", () => {
  it("registers a device", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
    (prisma.pushDeviceRegistration.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "reg-1",
      userId: "user-1",
      token: "device-token-123",
      platform: "ios",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await registerDeviceHandler(
      postRequest("/api/v1/notifications/register-device", {
        token: "device-token-123",
        platform: "ios",
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.token).toBe("device-token-123");
    expect(body.platform).toBe("ios");
  });

  it("returns 422 for missing token", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);

    const res = await registerDeviceHandler(
      postRequest("/api/v1/notifications/register-device", {
        platform: "ios",
      }),
    );

    expect(res.status).toBe(422);
  });

  it("returns 422 for invalid platform", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);

    const res = await registerDeviceHandler(
      postRequest("/api/v1/notifications/register-device", {
        token: "device-token-123",
        platform: "windows",
      }),
    );

    expect(res.status).toBe(422);
  });

  it("returns 401 when unauthenticated", async () => {
    const { ApiError } = await import("../../api/error.js");
    (authenticateRequest as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError("UNAUTHENTICATED", "Authentication required", 401),
    );

    const res = await registerDeviceHandler(
      postRequest("/api/v1/notifications/register-device", {
        token: "abc",
        platform: "ios",
      }),
    );

    expect(res.status).toBe(401);
  });
});
