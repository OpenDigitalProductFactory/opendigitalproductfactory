import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockAuth, mockOrg, mockBusinessContext } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockOrg: { findFirst: vi.fn(), update: vi.fn() },
  mockBusinessContext: { upsert: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@dpf/db", () => ({
  prisma: { organization: mockOrg, businessContext: mockBusinessContext },
}));

import { POST } from "./route";

function makeReq(body: unknown): NextRequest {
  return new Request("http://test/api/business-context/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  mockAuth.mockReset();
  mockOrg.findFirst.mockReset();
  mockOrg.update.mockReset();
  mockBusinessContext.upsert.mockReset();

  mockAuth.mockResolvedValue({ user: { type: "admin" } });
  mockOrg.findFirst.mockResolvedValue({ id: "org_1" });
  mockBusinessContext.upsert.mockResolvedValue({ id: "bc_1" });
});

describe("POST /api/business-context/setup", () => {
  it("does not write Organization.industry even if sent", async () => {
    await POST(makeReq({ industry: "fitness-recreation", description: "desc" }));
    const call = mockOrg.update.mock.calls[0]?.[0];
    expect(call?.data).not.toHaveProperty("industry");
  });

  it("does not write BusinessContext.industry even if sent", async () => {
    await POST(makeReq({ industry: "fitness-recreation", description: "desc" }));
    const call = mockBusinessContext.upsert.mock.calls[0]?.[0];
    expect(call?.create).not.toHaveProperty("industry");
    expect(call?.update).not.toHaveProperty("industry");
  });

  it("still writes non-industry fields normally", async () => {
    await POST(makeReq({ description: "Hello", targetMarket: "Locals" }));
    const call = mockBusinessContext.upsert.mock.calls[0]?.[0];
    expect(call?.create.description).toBe("Hello");
    expect(call?.create.targetMarket).toBe("Locals");
  });

  it("persists the source system when captured during setup", async () => {
    await POST(makeReq({ description: "Hello", sourceSystem: "QuickBooks and spreadsheets" }));
    const call = mockBusinessContext.upsert.mock.calls[0]?.[0];

    expect(call?.create.sourceSystem).toBe("QuickBooks and spreadsheets");
    expect(call?.update.sourceSystem).toBe("QuickBooks and spreadsheets");
  });

  it("does not overwrite source system when omitted from a partial update", async () => {
    await POST(makeReq({ description: "Hello" }));
    const call = mockBusinessContext.upsert.mock.calls[0]?.[0];

    expect(call?.update).not.toHaveProperty("sourceSystem");
  });
});
