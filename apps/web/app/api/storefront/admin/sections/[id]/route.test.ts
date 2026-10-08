import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockAuth, mockSection } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockSection: { findUnique: vi.fn(), update: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@dpf/db", () => ({ prisma: { storefrontSection: mockSection } }));

import { PATCH } from "./route";

const params = Promise.resolve({ id: "sec-1" });
const req = (body: unknown) =>
  new Request("http://test/api/storefront/admin/sections/sec-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;

beforeEach(() => {
  mockAuth.mockReset();
  mockSection.findUnique.mockReset();
  mockSection.update.mockReset();
  mockAuth.mockResolvedValue({ user: { type: "admin" } });
  mockSection.update.mockResolvedValue({});
});

describe("PATCH /api/storefront/admin/sections/[id] (BI-C279E20B)", () => {
  it("still toggles visibility", async () => {
    const res = await PATCH(req({ isVisible: false }), { params });
    expect(res.status).toBe(200);
    expect(mockSection.update).toHaveBeenCalledWith({ where: { id: "sec-1" }, data: { isVisible: false } });
  });

  it("saves owner text merged into the section's existing content", async () => {
    mockSection.findUnique.mockResolvedValue({ type: "about", content: { imageUrl: "/a.png" } });
    const res = await PATCH(req({ text: { body: "How we work" } }), { params });
    expect(res.status).toBe(200);
    expect(mockSection.update).toHaveBeenCalledWith({
      where: { id: "sec-1" },
      data: { content: { imageUrl: "/a.png", body: "How we work" } },
    });
  });

  it("refuses text the section type does not render", async () => {
    mockSection.findUnique.mockResolvedValue({ type: "items", content: {} });
    const res = await PATCH(req({ text: { body: "x" } }), { params });
    expect(res.status).toBe(400);
    expect(mockSection.update).not.toHaveBeenCalled();
  });

  it("requires an admin session", async () => {
    mockAuth.mockResolvedValue({ user: { type: "customer" } });
    const res = await PATCH(req({ isVisible: true }), { params });
    expect(res.status).toBe(401);
  });
});
