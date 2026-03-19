import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing route handlers
// ---------------------------------------------------------------------------

vi.mock("@dpf/db", () => ({
  prisma: {
    epic: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    epicPortfolio: {
      createMany: vi.fn(),
    },
    backlogItem: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("../../api/auth-middleware.js", () => ({
  authenticateRequest: vi.fn(),
}));

vi.mock("@dpf/validators", () => {
  const { z } = require("zod");
  return {
    createEpicSchema: z.object({
      title: z.string().min(1).max(200),
      description: z.string().max(5000).optional(),
      portfolioIds: z.array(z.string()).min(1),
    }),
    updateEpicSchema: z.object({
      title: z.string().min(1).max(200).optional(),
      description: z.string().max(5000).optional(),
      status: z.enum(["open", "in-progress", "done"]).optional(),
    }),
    createBacklogItemSchema: z.object({
      title: z.string().min(1).max(200),
      body: z.string().max(10000).optional(),
      type: z.enum(["product", "portfolio"]),
      epicId: z.string().optional(),
      priority: z.number().int().min(0).max(999).optional(),
    }),
    updateBacklogItemSchema: z.object({
      title: z.string().min(1).max(200).optional(),
      body: z.string().max(10000).optional(),
      status: z.enum(["open", "in-progress", "done", "deferred"]).optional(),
      priority: z.number().int().min(0).max(999).optional(),
      epicId: z.string().nullable().optional(),
    }),
  };
});

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { prisma } from "@dpf/db";
import { authenticateRequest } from "../../api/auth-middleware.js";

import { GET as epicsListHandler, POST as epicsCreateHandler } from "../../../app/api/v1/ops/epics/route.js";
import { PATCH as epicUpdateHandler } from "../../../app/api/v1/ops/epics/[id]/route.js";
import { GET as backlogListHandler, POST as backlogCreateHandler } from "../../../app/api/v1/ops/backlog/route.js";
import { PATCH as backlogUpdateHandler, DELETE as backlogDeleteHandler } from "../../../app/api/v1/ops/backlog/[id]/route.js";

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
  capabilities: ["view_admin", "manage_backlog"],
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

function patchRequest(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "PATCH",
    headers: { authorization: "Bearer valid-jwt", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function deleteRequest(path: string): Request {
  return new Request(`http://localhost${path}`, {
    method: "DELETE",
    headers: { authorization: "Bearer valid-jwt" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// EPICS LIST
// ===========================================================================
describe("GET /api/v1/ops/epics", () => {
  it("returns paginated epics", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
    (prisma.epic.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "epic-1",
        epicId: "EP-001",
        title: "First Epic",
        description: "A test epic",
        status: "open",
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-03-19"),
        completedAt: null,
        agentId: null,
        submittedBy: { email: "alice@example.com" },
        portfolios: [],
        items: [],
      },
    ]);

    const res = await epicsListHandler(getRequest("/api/v1/ops/epics"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toBeInstanceOf(Array);
    expect(body.data.length).toBe(1);
    expect(body.data[0].epicId).toBe("EP-001");
    expect(body.nextCursor).toBeNull();
  });

  it("returns 401 when unauthenticated", async () => {
    const { ApiError } = await import("../../api/error.js");
    (authenticateRequest as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError("UNAUTHENTICATED", "Authentication required", 401),
    );

    const res = await epicsListHandler(getRequest("/api/v1/ops/epics"));
    expect(res.status).toBe(401);
  });
});

// ===========================================================================
// EPICS CREATE
// ===========================================================================
describe("POST /api/v1/ops/epics", () => {
  it("creates an epic with valid input", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);

    const createdEpic = {
      id: "epic-new",
      epicId: "EP-abc123",
      title: "New Epic",
      status: "open",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        return fn({
          epic: { create: vi.fn().mockResolvedValue(createdEpic) },
          epicPortfolio: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
        });
      },
    );

    const res = await epicsCreateHandler(
      postRequest("/api/v1/ops/epics", {
        title: "New Epic",
        description: "Epic description",
        portfolioIds: ["port-1"],
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.title).toBe("New Epic");
  });

  it("returns 422 for invalid input", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);

    const res = await epicsCreateHandler(
      postRequest("/api/v1/ops/epics", {
        title: "", // too short
        portfolioIds: [],
      }),
    );

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });
});

// ===========================================================================
// EPICS UPDATE
// ===========================================================================
describe("PATCH /api/v1/ops/epics/:id", () => {
  it("updates an epic", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
    (prisma.epic.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "epic-1",
      status: "open",
    });
    (prisma.epic.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "epic-1",
      epicId: "EP-001",
      title: "Updated Epic",
      status: "in-progress",
    });

    const res = await epicUpdateHandler(
      patchRequest("/api/v1/ops/epics/epic-1", { title: "Updated Epic", status: "in-progress" }),
      { params: Promise.resolve({ id: "epic-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.title).toBe("Updated Epic");
  });

  it("returns 404 for nonexistent epic", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
    (prisma.epic.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await epicUpdateHandler(
      patchRequest("/api/v1/ops/epics/nonexistent", { title: "Nope" }),
      { params: Promise.resolve({ id: "nonexistent" }) },
    );

    expect(res.status).toBe(404);
  });

  it("returns 401 when unauthenticated", async () => {
    const { ApiError } = await import("../../api/error.js");
    (authenticateRequest as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError("UNAUTHENTICATED", "Authentication required", 401),
    );

    const res = await epicUpdateHandler(
      patchRequest("/api/v1/ops/epics/epic-1", { title: "Nope" }),
      { params: Promise.resolve({ id: "epic-1" }) },
    );

    expect(res.status).toBe(401);
  });
});

// ===========================================================================
// BACKLOG LIST
// ===========================================================================
describe("GET /api/v1/ops/backlog", () => {
  it("returns paginated backlog items", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
    (prisma.backlogItem.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "bi-1",
        itemId: "BI-ABCD1234",
        title: "Backlog Item 1",
        status: "open",
        type: "product",
        body: null,
        priority: 1,
        epicId: null,
        createdAt: new Date("2026-03-01"),
        updatedAt: new Date("2026-03-19"),
        completedAt: null,
        agentId: null,
        submittedBy: { email: "alice@example.com" },
        epic: null,
        digitalProduct: null,
        taxonomyNode: null,
      },
    ]);

    const res = await backlogListHandler(getRequest("/api/v1/ops/backlog"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toBeInstanceOf(Array);
    expect(body.data.length).toBe(1);
    expect(body.data[0].itemId).toBe("BI-ABCD1234");
  });

  it("applies status filter", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
    (prisma.backlogItem.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await backlogListHandler(getRequest("/api/v1/ops/backlog?status=done"));

    expect(prisma.backlogItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "done" }),
      }),
    );
  });

  it("applies epicId filter", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
    (prisma.backlogItem.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await backlogListHandler(getRequest("/api/v1/ops/backlog?epicId=epic-1"));

    expect(prisma.backlogItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ epicId: "epic-1" }),
      }),
    );
  });

  it("returns 401 when unauthenticated", async () => {
    const { ApiError } = await import("../../api/error.js");
    (authenticateRequest as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError("UNAUTHENTICATED", "Authentication required", 401),
    );

    const res = await backlogListHandler(getRequest("/api/v1/ops/backlog"));
    expect(res.status).toBe(401);
  });
});

// ===========================================================================
// BACKLOG CREATE
// ===========================================================================
describe("POST /api/v1/ops/backlog", () => {
  it("creates a backlog item", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
    (prisma.backlogItem.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "bi-new",
      itemId: "BI-ABCD1234",
      title: "New Item",
      type: "product",
      status: "open",
      priority: null,
      epicId: null,
    });

    const res = await backlogCreateHandler(
      postRequest("/api/v1/ops/backlog", {
        title: "New Item",
        type: "product",
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.title).toBe("New Item");
  });

  it("returns 422 for invalid input", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);

    const res = await backlogCreateHandler(
      postRequest("/api/v1/ops/backlog", {
        title: "",
        type: "invalid-type",
      }),
    );

    expect(res.status).toBe(422);
  });
});

// ===========================================================================
// BACKLOG UPDATE
// ===========================================================================
describe("PATCH /api/v1/ops/backlog/:id", () => {
  it("updates a backlog item", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
    (prisma.backlogItem.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "bi-1",
      status: "open",
    });
    (prisma.backlogItem.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "bi-1",
      itemId: "BI-ABCD1234",
      title: "Updated Item",
      status: "in-progress",
    });

    const res = await backlogUpdateHandler(
      patchRequest("/api/v1/ops/backlog/bi-1", { title: "Updated Item", status: "in-progress" }),
      { params: Promise.resolve({ id: "bi-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.title).toBe("Updated Item");
  });

  it("returns 404 for nonexistent item", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
    (prisma.backlogItem.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await backlogUpdateHandler(
      patchRequest("/api/v1/ops/backlog/nonexistent", { title: "Nope" }),
      { params: Promise.resolve({ id: "nonexistent" }) },
    );

    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// BACKLOG DELETE
// ===========================================================================
describe("DELETE /api/v1/ops/backlog/:id", () => {
  it("deletes a backlog item", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
    (prisma.backlogItem.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "bi-1",
    });
    (prisma.backlogItem.delete as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const res = await backlogDeleteHandler(
      deleteRequest("/api/v1/ops/backlog/bi-1"),
      { params: Promise.resolve({ id: "bi-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.deleted).toBe(true);
  });

  it("returns 404 for nonexistent item", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
    (prisma.backlogItem.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await backlogDeleteHandler(
      deleteRequest("/api/v1/ops/backlog/nonexistent"),
      { params: Promise.resolve({ id: "nonexistent" }) },
    );

    expect(res.status).toBe(404);
  });

  it("returns 401 when unauthenticated", async () => {
    const { ApiError } = await import("../../api/error.js");
    (authenticateRequest as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError("UNAUTHENTICATED", "Authentication required", 401),
    );

    const res = await backlogDeleteHandler(
      deleteRequest("/api/v1/ops/backlog/bi-1"),
      { params: Promise.resolve({ id: "bi-1" }) },
    );

    expect(res.status).toBe(401);
  });
});
