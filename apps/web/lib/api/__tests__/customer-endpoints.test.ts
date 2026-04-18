import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@dpf/db", () => ({
  prisma: {
    customerAccount: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("../../api/auth-middleware.js", () => ({
  authenticateRequest: vi.fn(),
}));

vi.mock("@dpf/validators", () => {
  const { z } = require("zod");
  return {
    updateCustomerSchema: z.object({
      name: z.string().min(1).max(200).optional(),
      industry: z.string().max(100).optional(),
      notes: z.string().max(5000).optional(),
    }),
  };
});

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { prisma } from "@dpf/db";
import { authenticateRequest } from "../../api/auth-middleware.js";

import { GET as accountsListHandler } from "../../../app/api/v1/customer/accounts/route.js";
import {
  GET as accountDetailHandler,
  PATCH as accountUpdateHandler,
} from "../../../app/api/v1/customer/accounts/[id]/route.js";

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

function patchRequest(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "PATCH",
    headers: { authorization: "Bearer valid-jwt", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// ACCOUNTS LIST
// ===========================================================================
describe("GET /api/v1/customer/accounts", () => {
  it("returns paginated accounts", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
    (prisma.customerAccount.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "acct-1",
        accountId: "ACCT-001",
        name: "Acme Corp",
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
        contacts: [],
      },
    ]);

    const res = await accountsListHandler(getRequest("/api/v1/customer/accounts"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toBeInstanceOf(Array);
    expect(body.data.length).toBe(1);
    expect(body.data[0].name).toBe("Acme Corp");
  });

  it("applies search filter", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
    (prisma.customerAccount.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await accountsListHandler(getRequest("/api/v1/customer/accounts?search=Acme"));

    expect(prisma.customerAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { name: { contains: "Acme", mode: "insensitive" } },
          ]),
        }),
      }),
    );
  });

  it("returns 401 when unauthenticated", async () => {
    const { ApiError } = await import("../../api/error.js");
    (authenticateRequest as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError("UNAUTHENTICATED", "Authentication required", 401),
    );

    const res = await accountsListHandler(getRequest("/api/v1/customer/accounts"));
    expect(res.status).toBe(401);
  });
});

// ===========================================================================
// ACCOUNT DETAIL
// ===========================================================================
describe("GET /api/v1/customer/accounts/:id", () => {
  it("returns account with contacts", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
    (prisma.customerAccount.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "acct-1",
      accountId: "ACCT-001",
      name: "Acme Corp",
      status: "active",
      contacts: [{ id: "contact-1", name: "Jane Doe" }],
    });

    const res = await accountDetailHandler(
      getRequest("/api/v1/customer/accounts/acct-1"),
      { params: Promise.resolve({ id: "acct-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBe("Acme Corp");
    expect(body.contacts.length).toBe(1);
  });

  it("returns 404 for nonexistent account", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
    (prisma.customerAccount.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await accountDetailHandler(
      getRequest("/api/v1/customer/accounts/nonexistent"),
      { params: Promise.resolve({ id: "nonexistent" }) },
    );

    expect(res.status).toBe(404);
  });

  it("returns 401 when unauthenticated", async () => {
    const { ApiError } = await import("../../api/error.js");
    (authenticateRequest as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError("UNAUTHENTICATED", "Authentication required", 401),
    );

    const res = await accountDetailHandler(
      getRequest("/api/v1/customer/accounts/acct-1"),
      { params: Promise.resolve({ id: "acct-1" }) },
    );

    expect(res.status).toBe(401);
  });
});

// ===========================================================================
// ACCOUNT UPDATE
// ===========================================================================
describe("PATCH /api/v1/customer/accounts/:id", () => {
  it("updates account name", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
    (prisma.customerAccount.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "acct-1",
    });
    (prisma.customerAccount.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "acct-1",
      name: "Acme Inc",
      status: "active",
      contacts: [],
    });

    const res = await accountUpdateHandler(
      patchRequest("/api/v1/customer/accounts/acct-1", { name: "Acme Inc" }),
      { params: Promise.resolve({ id: "acct-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBe("Acme Inc");
  });

  it("returns 404 for nonexistent account", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
    (prisma.customerAccount.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await accountUpdateHandler(
      patchRequest("/api/v1/customer/accounts/nonexistent", { name: "Nope" }),
      { params: Promise.resolve({ id: "nonexistent" }) },
    );

    expect(res.status).toBe(404);
  });

  it("returns 422 for invalid input", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);

    const res = await accountUpdateHandler(
      patchRequest("/api/v1/customer/accounts/acct-1", { name: "" }),
      { params: Promise.resolve({ id: "acct-1" }) },
    );

    expect(res.status).toBe(422);
  });

  it("returns 401 when unauthenticated", async () => {
    const { ApiError } = await import("../../api/error.js");
    (authenticateRequest as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError("UNAUTHENTICATED", "Authentication required", 401),
    );

    const res = await accountUpdateHandler(
      patchRequest("/api/v1/customer/accounts/acct-1", { name: "Nope" }),
      { params: Promise.resolve({ id: "acct-1" }) },
    );

    expect(res.status).toBe(401);
  });
});
