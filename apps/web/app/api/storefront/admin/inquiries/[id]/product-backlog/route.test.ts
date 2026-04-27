import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const {
  mockAuth,
  mockCan,
  mockStorefrontInquiry,
  mockDigitalProduct,
  mockBacklogItem,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockCan: vi.fn(),
  mockStorefrontInquiry: { findUnique: vi.fn() },
  mockDigitalProduct: { findUnique: vi.fn() },
  mockBacklogItem: { findUnique: vi.fn(), create: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/permissions", () => ({ can: mockCan }));
vi.mock("@dpf/db", () => ({
  prisma: {
    storefrontInquiry: mockStorefrontInquiry,
    digitalProduct: mockDigitalProduct,
    backlogItem: mockBacklogItem,
  },
}));

import { POST } from "./route";

function makeReq(body: unknown): NextRequest {
  return new Request("http://test/api/storefront/admin/inquiries/inquiry_1/product-backlog", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  mockAuth.mockReset();
  mockCan.mockReset();
  mockStorefrontInquiry.findUnique.mockReset();
  mockDigitalProduct.findUnique.mockReset();
  mockBacklogItem.findUnique.mockReset();
  mockBacklogItem.create.mockReset();

  mockAuth.mockResolvedValue({
    user: { id: "user_1", platformRole: "HR-000", isSuperuser: true },
  });
  mockCan.mockReturnValue(true);
  mockStorefrontInquiry.findUnique.mockResolvedValue({
    id: "inquiry_1",
    inquiryRef: "INQ-0001",
    customerName: "Jane Prospect",
    customerEmail: "jane@example.com",
    message: "I want to use DPF to run product operations.",
    storefront: {
      businessName: "Open Digital Product Factory",
      publicSlug: "open-digital-product-factory",
    },
  });
  mockDigitalProduct.findUnique.mockResolvedValue({
    id: "dp_1",
    name: "Open Digital Product Factory",
  });
  mockBacklogItem.findUnique.mockResolvedValue(null);
  mockBacklogItem.create.mockResolvedValue({
    id: "backlog_1",
    itemId: "BI-SFI-INQ0001",
    title: "Customer-zero product inquiry INQ-0001",
    status: "triaging",
  });
});

describe("POST /api/storefront/admin/inquiries/[id]/product-backlog", () => {
  it("returns 401 when the user cannot manage backlog", async () => {
    mockCan.mockReturnValue(false);

    const res = await POST(makeReq({ digitalProductId: "dp_1" }), {
      params: Promise.resolve({ id: "inquiry_1" }),
    });

    expect(res.status).toBe(401);
  });

  it("returns 400 when digitalProductId is missing", async () => {
    const res = await POST(makeReq({}), {
      params: Promise.resolve({ id: "inquiry_1" }),
    });

    expect(res.status).toBe(400);
  });

  it("creates a triaging backlog item from the inquiry", async () => {
    const res = await POST(makeReq({ digitalProductId: "dp_1" }), {
      params: Promise.resolve({ id: "inquiry_1" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.created).toBe(true);
    expect(body.backlogItem.itemId).toBe("BI-SFI-INQ0001");
    expect(mockBacklogItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "triaging",
          source: "user-request",
          digitalProductId: "dp_1",
        }),
      }),
    );
  });

  it("returns the existing backlog item instead of duplicating it", async () => {
    mockBacklogItem.findUnique.mockResolvedValue({
      id: "backlog_1",
      itemId: "BI-SFI-INQ0001",
      title: "Customer-zero product inquiry INQ-0001",
      status: "triaging",
    });

    const res = await POST(makeReq({ digitalProductId: "dp_1" }), {
      params: Promise.resolve({ id: "inquiry_1" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.created).toBe(false);
    expect(mockBacklogItem.create).not.toHaveBeenCalled();
  });
});
