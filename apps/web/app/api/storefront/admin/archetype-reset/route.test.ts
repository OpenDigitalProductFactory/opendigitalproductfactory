import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockAuth, mockOrganization, mockReset } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockOrganization: { findFirst: vi.fn() },
  mockReset: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@dpf/db", () => ({
  prisma: { organization: mockOrganization },
}));
vi.mock("@/lib/storefront/archetype-reset", () => ({
  resetStorefrontArchetype: mockReset,
}));

import { POST } from "./route";

function makeReq(body: unknown): NextRequest {
  return new Request("http://test/api/storefront/admin/archetype-reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  mockAuth.mockReset();
  mockOrganization.findFirst.mockReset();
  mockReset.mockReset();

  mockAuth.mockResolvedValue({ user: { type: "admin" } });
  mockOrganization.findFirst.mockResolvedValue({ id: "org_1" });
  mockReset.mockResolvedValue({
    storefrontId: "sf_1",
    archetypeId: "software-platform",
    category: "software-platform",
    sectionsCreated: 2,
    itemsCreated: 3,
  });
});

describe("POST /api/storefront/admin/archetype-reset", () => {
  it("returns 401 for non-admin", async () => {
    mockAuth.mockResolvedValue({ user: { type: "user" } });
    const res = await POST(makeReq({ targetArchetypeId: "software-platform" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when target archetype is missing", async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
  });

  it("returns 200 with reset summary for admin", async () => {
    const res = await POST(makeReq({ targetArchetypeId: "software-platform" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.result.archetypeId).toBe("software-platform");
    expect(mockReset).toHaveBeenCalledWith({
      organizationId: "org_1",
      targetArchetypeId: "software-platform",
      mode: "replace-seeded-content",
    });
  });
});
