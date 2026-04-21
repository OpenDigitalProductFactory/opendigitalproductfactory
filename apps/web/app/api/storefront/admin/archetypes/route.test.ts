import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockAuth, mockArchetype } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockArchetype: { findUnique: vi.fn(), create: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@dpf/db", () => ({
  prisma: { storefrontArchetype: mockArchetype },
}));

import { POST } from "./route";

function makeReq(body: unknown): NextRequest {
  return new Request("http://test/api/storefront/admin/archetypes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

const validBody = {
  name: "Weird Biz",
  ctaType: "inquiry",
  itemTemplates: [{ name: "x", description: "", priceType: "quote" }],
  sectionTemplates: [],
  formSchema: [],
  tags: [],
};

beforeEach(() => {
  mockAuth.mockReset();
  mockArchetype.findUnique.mockReset();
  mockArchetype.create.mockReset();

  mockAuth.mockResolvedValue({ user: { type: "admin" } });
  mockArchetype.findUnique.mockResolvedValue(null);
  mockArchetype.create.mockImplementation(async ({ data }: { data: unknown }) => ({
    ...(data as object),
  }));
});

describe("POST /api/storefront/admin/archetypes", () => {
  it("rejects a custom archetype with a non-canonical category", async () => {
    const res = await POST(makeReq({ ...validBody, category: "weird-biz" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/category/i);
    expect(mockArchetype.create).not.toHaveBeenCalled();
  });

  it("accepts a custom archetype whose category is in the canonical list", async () => {
    const res = await POST(makeReq({ ...validBody, category: "professional-services" }));
    expect(res.status).toBe(201); // route returns 201 Created
  });
});
