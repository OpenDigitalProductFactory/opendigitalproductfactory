import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("nanoid", () => ({ nanoid: vi.fn(() => "TESTREF") }));
vi.mock("@dpf/db", () => ({
  prisma: {
    storefrontConfig: { findFirst: vi.fn() },
    storefrontInquiry: { create: vi.fn() },
    storefrontBooking: { create: vi.fn() },
    storefrontDonation: { create: vi.fn() },
  },
}));

import { submitInquiry, submitDonation } from "./storefront-actions";
import { prisma } from "@dpf/db";

const mockPublishedStorefront = { id: "sf-1", isPublished: true };
const mockUnpublishedStorefront = { id: "sf-1", isPublished: false };

describe("submitInquiry", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns error when storefront is not published", async () => {
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue(
      mockUnpublishedStorefront as never
    );
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
  beforeEach(() => vi.clearAllMocks());

  it("returns error when storefront not found", async () => {
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue(null as never);
    const result = await submitDonation("missing-slug", {
      donorEmail: "d@e.com",
      amount: 10,
    });
    expect(result.success).toBe(false);
  });
});
