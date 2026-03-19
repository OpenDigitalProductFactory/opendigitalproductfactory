import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing route handlers
// ---------------------------------------------------------------------------

vi.mock("@dpf/db", () => ({
  prisma: {
    epic: { groupBy: vi.fn() },
    backlogItem: { groupBy: vi.fn(), findMany: vi.fn() },
    portfolio: { count: vi.fn() },
    digitalProduct: { count: vi.fn() },
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

import { GET as dashboardHandler } from "../../../app/api/v1/workspace/dashboard/route.js";
import { GET as activityHandler } from "../../../app/api/v1/workspace/activity/route.js";

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
  capabilities: ["view_admin", "view_portfolio"],
};

function getRequest(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, {
    method: "GET",
    headers: { authorization: "Bearer valid-jwt", ...headers },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// DASHBOARD
// ===========================================================================
describe("GET /api/v1/workspace/dashboard", () => {
  it("returns dashboard tiles and calendar items", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
    (prisma.epic.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([
      { status: "open", _count: { id: 5 } },
      { status: "done", _count: { id: 3 } },
    ]);
    (prisma.backlogItem.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([
      { status: "open", _count: { id: 10 } },
      { status: "in-progress", _count: { id: 4 } },
      { status: "done", _count: { id: 7 } },
    ]);
    (prisma.portfolio.count as ReturnType<typeof vi.fn>).mockResolvedValue(4);
    (prisma.digitalProduct.count as ReturnType<typeof vi.fn>).mockResolvedValue(12);
    (prisma.backlogItem.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "item-1",
        itemId: "BKL-001",
        title: "Build login page",
        updatedAt: new Date("2026-03-19"),
        status: "in-progress",
      },
    ]);

    const req = getRequest("/api/v1/workspace/dashboard");
    const res = await dashboardHandler(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.tiles).toBeInstanceOf(Array);
    expect(body.tiles.length).toBe(7);

    // Verify specific tile values
    const epicTile = body.tiles.find((t: { label: string }) => t.label === "Total Epics");
    expect(epicTile.value).toBe(8);

    const openEpicTile = body.tiles.find((t: { label: string }) => t.label === "Open Epics");
    expect(openEpicTile.value).toBe(5);

    const portfolioTile = body.tiles.find((t: { label: string }) => t.label === "Portfolios");
    expect(portfolioTile.value).toBe(4);

    const productTile = body.tiles.find((t: { label: string }) => t.label === "Digital Products");
    expect(productTile.value).toBe(12);

    // Calendar items
    expect(body.calendarItems).toBeInstanceOf(Array);
    expect(body.calendarItems.length).toBe(1);
    expect(body.calendarItems[0].title).toBe("Build login page");
  });

  it("returns 401 when unauthenticated", async () => {
    const { ApiError } = await import("../../api/error.js");
    (authenticateRequest as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError("UNAUTHENTICATED", "Authentication required", 401),
    );

    const req = getRequest("/api/v1/workspace/dashboard");
    const res = await dashboardHandler(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe("UNAUTHENTICATED");
  });
});

// ===========================================================================
// ACTIVITY
// ===========================================================================
describe("GET /api/v1/workspace/activity", () => {
  it("returns paginated activity items", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
    (prisma.backlogItem.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "item-1",
        title: "Build login page",
        status: "in-progress",
        type: "product",
        updatedAt: new Date("2026-03-19"),
      },
      {
        id: "item-2",
        title: "Fix navigation bug",
        status: "done",
        type: "product",
        updatedAt: new Date("2026-03-18"),
      },
    ]);

    const req = getRequest("/api/v1/workspace/activity?limit=10");
    const res = await activityHandler(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toBeInstanceOf(Array);
    expect(body.data.length).toBe(2);
    expect(body.data[0].title).toBe("Build login page");
    expect(body.nextCursor).toBeNull();
  });

  it("returns nextCursor when more items exist", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);

    // Return limit+1 items to trigger pagination
    const items = Array.from({ length: 3 }, (_, i) => ({
      id: `item-${i}`,
      title: `Task ${i}`,
      status: "open",
      type: "product",
      updatedAt: new Date("2026-03-19"),
    }));
    (prisma.backlogItem.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(items);

    const req = getRequest("/api/v1/workspace/activity?limit=2");
    const res = await activityHandler(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.length).toBe(2);
    expect(body.nextCursor).toBe("item-1");
  });

  it("returns 401 when unauthenticated", async () => {
    const { ApiError } = await import("../../api/error.js");
    (authenticateRequest as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError("UNAUTHENTICATED", "Authentication required", 401),
    );

    const req = getRequest("/api/v1/workspace/activity");
    const res = await activityHandler(req);

    expect(res.status).toBe(401);
  });
});
