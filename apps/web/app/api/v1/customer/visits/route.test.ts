/**
 * Tests for GET /api/v1/customer/visits — the customer-scoped "My visits"
 * endpoint backing the generic mobile app's customer mode.
 *
 * Contract: a signed-in customer sees ONLY their own contact's bookings,
 * never another customer's. Workforce auth must be rejected.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockContactsFindMany, mockBookingsFindMany } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockContactsFindMany: vi.fn(),
  mockBookingsFindMany: vi.fn(),
}));

vi.mock("@/lib/api/auth-middleware", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/api/auth-middleware")
  >("@/lib/api/auth-middleware");
  return { ...actual, requireCustomerAuth: mockAuth };
});

vi.mock("@dpf/db", () => ({
  prisma: {
    customerContact: { findMany: mockContactsFindMany },
    storefrontBooking: { findMany: mockBookingsFindMany },
  },
  Prisma: {},
}));

import { GET } from "./route";
import { ApiError } from "@/lib/api/error";

const CUSTOMER_AUTH = {
  user: {
    id: "u_c1",
    email: "alice@example.com",
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

const SERVER_BOOKING = {
  id: "BK-1",
  bookingRef: "BK-0001",
  scheduledAt: new Date("2026-07-10T10:00:00.000Z"),
  durationMinutes: 60,
  status: "confirmed",
  notes: null,
  cancellationReason: null,
  createdAt: new Date("2026-06-01T00:00:00.000Z"),
  itemId: "Tune-up",
  provider: { name: "Dale" },
};

beforeEach(() => {
  mockAuth.mockReset();
  mockContactsFindMany.mockReset();
  mockBookingsFindMany.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

function makeReq(query = ""): Request {
  return new Request(`https://example/api/v1/customer/visits${query}`);
}

describe("GET /api/v1/customer/visits", () => {
  it("rejects unauthenticated callers with 401", async () => {
    mockAuth.mockRejectedValueOnce(
      new ApiError("UNAUTHENTICATED", "Authentication required", 401),
    );
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    expect(mockContactsFindMany).not.toHaveBeenCalled();
  });

  it("rejects workforce (admin) callers with 403 — they use the storefront route", async () => {
    mockAuth.mockRejectedValueOnce(
      new ApiError(
        "FORBIDDEN",
        "This endpoint requires customer authentication",
        403,
      ),
    );
    const res = await GET(makeReq());
    expect(res.status).toBe(403);
  });

  it("returns an empty page when the customer has no accountId on session", async () => {
    mockAuth.mockResolvedValueOnce({
      ...CUSTOMER_AUTH,
      user: { ...CUSTOMER_AUTH.user, accountId: null },
    });
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
    expect(mockContactsFindMany).not.toHaveBeenCalled();
  });

  it("returns an empty page when the account has no contacts at all", async () => {
    mockAuth.mockResolvedValueOnce(CUSTOMER_AUTH);
    mockContactsFindMany.mockResolvedValueOnce([]);
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    expect(mockBookingsFindMany).not.toHaveBeenCalled();
  });

  it("scopes bookings to the customer's contact set", async () => {
    mockAuth.mockResolvedValueOnce(CUSTOMER_AUTH);
    mockContactsFindMany.mockResolvedValueOnce([
      { id: "con_1" },
      { id: "con_2" },
    ]);
    mockBookingsFindMany.mockResolvedValueOnce([SERVER_BOOKING]);

    const res = await GET(makeReq());
    expect(res.status).toBe(200);

    const contactsCall = mockContactsFindMany.mock.calls[0][0];
    expect(contactsCall.where.account).toEqual({
      is: { accountId: "ACC-ACME" },
    });
    const bookingsCall = mockBookingsFindMany.mock.calls[0][0];
    expect(bookingsCall.where.customerContactId).toEqual({
      in: ["con_1", "con_2"],
    });
    // The select must NOT leak admin-only fields.
    expect(bookingsCall.select.idempotencyKey).toBeUndefined();
  });

  it("applies upcoming=true as scheduledAt >= now", async () => {
    mockAuth.mockResolvedValueOnce(CUSTOMER_AUTH);
    mockContactsFindMany.mockResolvedValueOnce([{ id: "con_1" }]);
    mockBookingsFindMany.mockResolvedValueOnce([]);

    await GET(makeReq("?upcoming=true"));
    const call = mockBookingsFindMany.mock.calls[0][0];
    expect(call.where.scheduledAt.gte).toBeInstanceOf(Date);
  });

  it("forwards the status filter when supplied", async () => {
    mockAuth.mockResolvedValueOnce(CUSTOMER_AUTH);
    mockContactsFindMany.mockResolvedValueOnce([{ id: "con_1" }]);
    mockBookingsFindMany.mockResolvedValueOnce([]);

    await GET(makeReq("?status=confirmed"));
    expect(mockBookingsFindMany.mock.calls[0][0].where.status).toBe("confirmed");
  });

  it("projects unknown stored statuses to 'pending' instead of leaking junk", async () => {
    mockAuth.mockResolvedValueOnce(CUSTOMER_AUTH);
    mockContactsFindMany.mockResolvedValueOnce([{ id: "con_1" }]);
    mockBookingsFindMany.mockResolvedValueOnce([
      { ...SERVER_BOOKING, status: "weird-legacy-value" },
    ]);

    const res = await GET(makeReq());
    const body = (await res.json()) as { data: { status: string }[] };
    expect(body.data[0].status).toBe("pending");
  });
});
