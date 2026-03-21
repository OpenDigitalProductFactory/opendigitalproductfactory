import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@dpf/db", () => ({
  prisma: {
    storefrontItem: { findFirst: vi.fn() },
    storefrontConfig: { findFirst: vi.fn() },
    bookingHold: {
      count: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/slot-engine", () => ({
  getAvailableDates: vi.fn(),
  computeAvailableSlots: vi.fn(),
}));

vi.mock("@/lib/slot-engine/validate-item", () => ({
  validateItemOwnership: vi.fn(),
}));

// Imports after mocks — use relative paths because Vitest/Node ESM cannot
// resolve @/ aliases for Next.js dynamic-route folders (bracket names).
import { GET as datesGET } from "../../app/api/storefront/[slug]/dates/route";
import { GET as slotsGET } from "../../app/api/storefront/[slug]/slots/route";
import { POST as holdPOST } from "../../app/api/storefront/[slug]/hold/route";
import { prisma } from "@dpf/db";
import { getAvailableDates, computeAvailableSlots } from "@/lib/slot-engine";
import { validateItemOwnership } from "@/lib/slot-engine/validate-item";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeParams(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

// ── GET /dates ────────────────────────────────────────────────────────────────

describe("GET /api/storefront/[slug]/dates", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns 400 when itemId is missing", async () => {
    const req = new NextRequest(
      "http://localhost/api/storefront/test-org/dates?month=2026-03"
    );
    const res = await datesGET(req, makeParams("test-org"));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toMatch(/itemId/i);
  });

  it("returns 400 when month is missing", async () => {
    const req = new NextRequest(
      "http://localhost/api/storefront/test-org/dates?itemId=itm-1"
    );
    const res = await datesGET(req, makeParams("test-org"));

    expect(res.status).toBe(400);
  });

  it("returns 404 when item does not belong to the storefront", async () => {
    vi.mocked(validateItemOwnership).mockResolvedValue(false);

    const req = new NextRequest(
      "http://localhost/api/storefront/test-org/dates?itemId=itm-1&month=2026-03"
    );
    const res = await datesGET(req, makeParams("test-org"));
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.error).toMatch(/not found/i);
  });

  it("returns dates array on success", async () => {
    vi.mocked(validateItemOwnership).mockResolvedValue(true);
    vi.mocked(getAvailableDates).mockResolvedValue(["2026-03-10", "2026-03-11"]);

    const req = new NextRequest(
      "http://localhost/api/storefront/test-org/dates?itemId=itm-1&month=2026-03"
    );
    const res = await datesGET(req, makeParams("test-org"));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.dates).toEqual(["2026-03-10", "2026-03-11"]);
    expect(getAvailableDates).toHaveBeenCalledWith("itm-1", "2026-03");
  });
});

// ── GET /slots ────────────────────────────────────────────────────────────────

describe("GET /api/storefront/[slug]/slots", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns 400 when date is missing", async () => {
    const req = new NextRequest(
      "http://localhost/api/storefront/test-org/slots?itemId=itm-1"
    );
    const res = await slotsGET(req, makeParams("test-org"));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toMatch(/date/i);
  });

  it("returns 404 when item does not belong to the storefront", async () => {
    vi.mocked(validateItemOwnership).mockResolvedValue(false);

    const req = new NextRequest(
      "http://localhost/api/storefront/test-org/slots?itemId=itm-1&date=2026-03-10"
    );
    const res = await slotsGET(req, makeParams("test-org"));

    expect(res.status).toBe(404);
  });

  it("returns slot result on success", async () => {
    vi.mocked(validateItemOwnership).mockResolvedValue(true);
    const mockResult = {
      mode: "next-available" as const,
      slots: [{ startTime: "09:00", endTime: "09:45", providerId: "prov-1" }],
    };
    vi.mocked(computeAvailableSlots).mockResolvedValue(mockResult);

    const req = new NextRequest(
      "http://localhost/api/storefront/test-org/slots?itemId=itm-1&date=2026-03-10"
    );
    const res = await slotsGET(req, makeParams("test-org"));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.mode).toBe("next-available");
    expect(data.slots).toHaveLength(1);
    expect(computeAvailableSlots).toHaveBeenCalledWith("itm-1", "2026-03-10", {
      providerId: undefined,
      holderToken: undefined,
    });
  });

  it("forwards providerId and holderToken query params", async () => {
    vi.mocked(validateItemOwnership).mockResolvedValue(true);
    vi.mocked(computeAvailableSlots).mockResolvedValue({
      mode: "next-available",
      slots: [],
    });

    const req = new NextRequest(
      "http://localhost/api/storefront/test-org/slots?itemId=itm-1&date=2026-03-10&providerId=prov-1&holderToken=tok-abc"
    );
    await slotsGET(req, makeParams("test-org"));

    expect(computeAvailableSlots).toHaveBeenCalledWith("itm-1", "2026-03-10", {
      providerId: "prov-1",
      holderToken: "tok-abc",
    });
  });
});

// ── POST /hold ────────────────────────────────────────────────────────────────

describe("POST /api/storefront/[slug]/hold", () => {
  const validBody = {
    itemId: "itm-1",
    slotStart: "2026-03-10T09:00:00Z",
    slotEnd: "2026-03-10T09:45:00Z",
  };

  function makeHoldRequest(body: Record<string, unknown>) {
    return new NextRequest(
      "http://localhost/api/storefront/test-org/hold",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
  }

  beforeEach(() => { vi.clearAllMocks(); });

  it("returns 400 when required fields are missing", async () => {
    const req = makeHoldRequest({ itemId: "itm-1" });
    const res = await holdPOST(req, makeParams("test-org"));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toMatch(/required/i);
  });

  it("returns 404 when storefront is not found", async () => {
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue(null as never);

    const req = makeHoldRequest(validBody);
    const res = await holdPOST(req, makeParams("test-org"));

    expect(res.status).toBe(404);
  });

  it("returns 429 when global hold limit is exceeded", async () => {
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue({ id: "sf-1" } as never);
    // First count call (global) returns 50
    vi.mocked(prisma.bookingHold.count).mockResolvedValueOnce(50 as never);

    const req = makeHoldRequest(validBody);
    const res = await holdPOST(req, makeParams("test-org"));
    const data = await res.json();

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(data.error).toMatch(/too many/i);
  });

  it("returns 429 when per-IP hold limit is exceeded", async () => {
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue({ id: "sf-1" } as never);
    // Global count is fine, IP count is at limit
    vi.mocked(prisma.bookingHold.count)
      .mockResolvedValueOnce(10 as never)  // global
      .mockResolvedValueOnce(3 as never);  // per-IP

    const req = makeHoldRequest(validBody);
    const res = await holdPOST(req, makeParams("test-org"));
    const data = await res.json();

    expect(res.status).toBe(429);
    expect(data.error).toMatch(/client/i);
  });

  it("returns 409 when slot is already held by another token", async () => {
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue({ id: "sf-1" } as never);
    vi.mocked(prisma.bookingHold.count)
      .mockResolvedValueOnce(0 as never)  // global
      .mockResolvedValueOnce(0 as never); // per-IP
    vi.mocked(prisma.bookingHold.findFirst).mockResolvedValue({ id: "hold-1" } as never);

    const req = makeHoldRequest({ ...validBody, providerId: "prov-1" });
    const res = await holdPOST(req, makeParams("test-org"));
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.error).toMatch(/already held/i);
  });

  it("returns 201 with holderToken and expiresAt on success", async () => {
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue({ id: "sf-1" } as never);
    vi.mocked(prisma.bookingHold.count)
      .mockResolvedValueOnce(0 as never)  // global
      .mockResolvedValueOnce(0 as never); // per-IP
    vi.mocked(prisma.bookingHold.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.bookingHold.create).mockResolvedValue({
      holderToken: "tok-uuid-1234",
      expiresAt,
    } as never);

    const req = makeHoldRequest({ ...validBody, providerId: "prov-1" });
    const res = await holdPOST(req, makeParams("test-org"));
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.holderToken).toBe("tok-uuid-1234");
    expect(data.expiresAt).toBeDefined();
  });

  it("skips conflict check when no providerId is supplied", async () => {
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue({ id: "sf-1" } as never);
    vi.mocked(prisma.bookingHold.count)
      .mockResolvedValueOnce(0 as never)
      .mockResolvedValueOnce(0 as never);
    vi.mocked(prisma.bookingHold.create).mockResolvedValue({
      holderToken: "tok-no-provider",
      expiresAt,
    } as never);

    const req = makeHoldRequest(validBody); // no providerId
    const res = await holdPOST(req, makeParams("test-org"));

    expect(res.status).toBe(201);
    // findFirst for conflict should NOT have been called
    expect(prisma.bookingHold.findFirst).not.toHaveBeenCalled();
  });
});
