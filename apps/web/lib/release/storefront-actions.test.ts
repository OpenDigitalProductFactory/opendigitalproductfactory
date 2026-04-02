import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("nanoid", () => ({ nanoid: vi.fn(() => "TESTREF") }));
vi.mock("@/lib/actions/finance", () => ({
  generateInvoiceFromStorefrontOrder: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@dpf/db", () => ({
  prisma: {
    storefrontConfig: { findFirst: vi.fn() },
    storefrontInquiry: { create: vi.fn() },
    storefrontBooking: { create: vi.fn() },
    storefrontOrder: { create: vi.fn() },
    storefrontDonation: { create: vi.fn() },
    bookingHold: { findFirst: vi.fn(), delete: vi.fn() },
  },
}));

import { submitInquiry, submitDonation, submitBooking } from "./storefront-actions";
import { prisma } from "@dpf/db";

const mockPublishedStorefront = { id: "sf-1" };

describe("submitInquiry", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns error when storefront is not published", async () => {
    // WHERE { isPublished: true } returns null when unpublished — simulate that here
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue(null as never);
    const result = await submitInquiry("acme-vet", {
      customerEmail: "a@b.com",
      customerName: "Alice",
      message: "Hello",
    });
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toMatch(/not found/i);
  });

  it("creates inquiry and returns ref when storefront is published", async () => {
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue(
      mockPublishedStorefront as never
    );
    vi.mocked(prisma.storefrontInquiry.create).mockResolvedValue({
      inquiryRef: "INQ-TESTREF",
    } as never);

    const result = await submitInquiry("acme-vet", {
      customerEmail: "a@b.com",
      customerName: "Alice",
      message: "Hello",
    });
    expect(result.success).toBe(true);
    expect((result as { success: true; ref: string; type: string }).ref).toBe("INQ-TESTREF");
    expect((result as { success: true; ref: string; type: string }).type).toBe("inquiry");
  });
});

describe("submitDonation", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns error when storefront not found", async () => {
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue(null as never);
    const result = await submitDonation("missing-slug", {
      donorEmail: "d@e.com",
      amount: 10,
    });
    expect(result.success).toBe(false);
  });
});

describe("submitBooking (enhanced)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("validates hold token before creating booking", async () => {
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue({ id: "sf-1" } as never);
    vi.mocked(prisma.bookingHold.findFirst).mockResolvedValue({
      id: "hold-1", holderToken: "tok-abc", providerId: "prov-1",
      slotStart: new Date("2026-03-23T09:00:00Z"), slotEnd: new Date("2026-03-23T09:45:00Z"),
      expiresAt: new Date(Date.now() + 600_000),
    } as never);
    vi.mocked(prisma.bookingHold.delete).mockResolvedValue({} as never);
    vi.mocked(prisma.storefrontBooking.create).mockResolvedValue({ id: "bk-1", bookingRef: "BK-TESTREF" } as never);

    const result = await submitBooking("acme", {
      itemId: "itm-1", customerEmail: "a@b.com", customerName: "Alice",
      scheduledAt: new Date("2026-03-23T09:00:00Z"), durationMinutes: 45,
      holderToken: "tok-abc",
    });
    expect(result.success).toBe(true);
    expect(prisma.bookingHold.delete).toHaveBeenCalledWith({ where: { id: "hold-1" } });
  });

  it("rejects booking when hold token is invalid", async () => {
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue({ id: "sf-1" } as never);
    vi.mocked(prisma.bookingHold.findFirst).mockResolvedValue(null as never);

    const result = await submitBooking("acme", {
      itemId: "itm-1", customerEmail: "a@b.com", customerName: "Alice",
      scheduledAt: new Date("2026-03-23T09:00:00Z"), durationMinutes: 45,
      holderToken: "invalid-token",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/invalid|expired/i);
  });

  it("rejects duplicate submission via idempotency key", async () => {
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue({ id: "sf-1" } as never);
    vi.mocked(prisma.bookingHold.findFirst).mockResolvedValue({
      id: "hold-2", holderToken: "tok-def", expiresAt: new Date(Date.now() + 600_000),
    } as never);
    vi.mocked(prisma.bookingHold.delete).mockResolvedValue({} as never);
    const prismaError = new Error("Unique constraint") as Error & { code: string };
    prismaError.code = "P2002";
    vi.mocked(prisma.storefrontBooking.create).mockRejectedValue(prismaError);

    const result = await submitBooking("acme", {
      itemId: "itm-1", customerEmail: "a@b.com", customerName: "Alice",
      scheduledAt: new Date("2026-03-23T09:00:00Z"), durationMinutes: 45,
      holderToken: "tok-def", idempotencyKey: "dup-key",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/duplicate/i);
  });
});

describe("submitBooking (recurring)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("creates child bookings for weekly recurrence", async () => {
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue({ id: "sf-1" } as never);
    vi.mocked(prisma.storefrontBooking.create).mockResolvedValue({ id: "bk-parent", bookingRef: "BK-TESTREF" } as never);

    const result = await submitBooking("acme", {
      itemId: "itm-1", customerEmail: "a@b.com", customerName: "Alice",
      scheduledAt: new Date("2026-03-23T09:00:00Z"), durationMinutes: 45,
      recurrenceRule: "weekly" as const,
      recurrenceEndDate: new Date("2026-04-13T00:00:00Z"), // ~3 weeks out
    });
    expect(result.success).toBe(true);
    // Parent + 3 children = 4 total create calls
    expect(prisma.storefrontBooking.create).toHaveBeenCalledTimes(4);
  });
});
