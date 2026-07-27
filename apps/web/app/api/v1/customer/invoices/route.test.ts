/**
 * Unit tests for GET /api/v1/customer/invoices — the customer-scoped
 * "My invoices" endpoint that backs the generic mobile app's customer mode.
 *
 * The key contract: a signed-in customer sees ONLY their own account's
 * invoices, scoped by `CustomerAccount.accountId === user.accountId`.
 * Workforce auth must be rejected (they have /api/v1/finance/invoices).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockFindMany } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockFindMany: vi.fn(),
}));

vi.mock("@/lib/api/auth-middleware", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/api/auth-middleware")
  >("@/lib/api/auth-middleware");
  return {
    ...actual,
    requireCustomerAuth: mockAuth,
  };
});

vi.mock("@dpf/db", () => ({
  prisma: {
    invoice: {
      findMany: mockFindMany,
    },
  },
  Prisma: {},
}));

import { GET } from "./route";
import { ApiError } from "@/lib/api/error";

const CUSTOMER_AUTH = {
  user: {
    id: "u_c1",
    email: "alice@acme.example",
    type: "customer" as const,
    platformRole: null,
    isSuperuser: false,
    accountId: "ACC-ACME",
    accountName: "Acme",
    contactId: "CON-1",
  },
  capabilities: [] as string[],
  authContext: {
    principalId: null,
    principalAliases: [],
    population: "customer" as const,
    platformRole: null,
    isSuperuser: false,
    employeeId: null,
    managerScope: null,
    teamIds: [],
    accountScope: {
      accountIds: ["ACCT-1"],
      contactIds: ["CON-1"],
      partnerAccountIds: [],
    },
    sensitivityClearance: ["public" as const],
    authentication: {
      source: "session" as const,
      methods: [],
      contextClassReference: null,
    },
    actingHumanUserId: null,
    actingAgentId: null,
    delegationGrantIds: [],
    grantedCapabilities: [] as string[],
  },
};

const SERVER_INVOICE = {
  id: "INV-1",
  invoiceRef: "INV-0001",
  type: "standard",
  status: "sent",
  currency: "USD",
  subtotal: 250,
  taxAmount: 25,
  discountAmount: 0,
  totalAmount: 275,
  amountPaid: 0,
  amountDue: 275,
  dueDate: new Date("2026-07-16"),
  sentAt: new Date("2026-06-16"),
  paidAt: null,
  createdAt: new Date("2026-06-16T22:00:00.000Z"),
  updatedAt: new Date("2026-06-16T22:00:00.000Z"),
  account: { id: "ACC-DB-1", name: "Acme HVAC Co" },
};

beforeEach(() => {
  mockAuth.mockReset();
  mockFindMany.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

function makeReq(query = ""): Request {
  return new Request(`https://example/api/v1/customer/invoices${query}`);
}

describe("GET /api/v1/customer/invoices", () => {
  it("rejects unauthenticated callers with 401 via requireCustomerAuth", async () => {
    mockAuth.mockRejectedValueOnce(
      new ApiError("UNAUTHENTICATED", "Authentication required", 401),
    );
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("rejects a workforce (admin) caller with 403 — they use /finance/invoices", async () => {
    mockAuth.mockRejectedValueOnce(
      new ApiError(
        "FORBIDDEN",
        "This endpoint requires customer authentication",
        403,
      ),
    );
    const res = await GET(makeReq());
    expect(res.status).toBe(403);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("scopes the query to the signed-in customer's account.accountId", async () => {
    mockAuth.mockResolvedValueOnce(CUSTOMER_AUTH);
    mockFindMany.mockResolvedValueOnce([SERVER_INVOICE]);

    const res = await GET(makeReq());
    expect(res.status).toBe(200);

    const call = mockFindMany.mock.calls[0][0];
    expect(call.where.account).toEqual({ is: { accountId: "ACC-ACME" } });
    expect(call.orderBy).toEqual({ createdAt: "desc" });
    // The select must NOT leak internalNotes or other admin-only fields.
    expect(call.select.internalNotes).toBeUndefined();
    expect(call.select.payToken).toBeUndefined();
  });

  it("returns an empty page when the customer has no accountId on session", async () => {
    mockAuth.mockResolvedValueOnce({
      ...CUSTOMER_AUTH,
      user: { ...CUSTOMER_AUTH.user, accountId: null },
    });

    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[]; nextCursor: string | null };
    expect(body.data).toEqual([]);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("forwards the status filter when supplied", async () => {
    mockAuth.mockResolvedValueOnce(CUSTOMER_AUTH);
    mockFindMany.mockResolvedValueOnce([]);

    await GET(makeReq("?status=sent"));
    const call = mockFindMany.mock.calls[0][0];
    expect(call.where.status).toBe("sent");
  });
});
