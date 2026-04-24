import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockConnectQuickBooks } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockConnectQuickBooks: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/integrate/quickbooks/connect-action", () => ({
  connectQuickBooks: mockConnectQuickBooks,
}));

import { POST } from "./route";

function makeReq(body: unknown, options: { raw?: string } = {}): Request {
  const bodyText = options.raw !== undefined ? options.raw : JSON.stringify(body);
  return new Request("http://test/api/integrations/quickbooks/connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: bodyText,
  });
}

beforeEach(() => {
  mockAuth.mockReset();
  mockConnectQuickBooks.mockReset();
});

describe("POST /api/integrations/quickbooks/connect", () => {
  it("returns 401 when no session", async () => {
    mockAuth.mockResolvedValue(null);

    const res = await POST(makeReq({}));
    expect(res.status).toBe(401);
    expect(mockConnectQuickBooks).not.toHaveBeenCalled();
  });

  it("returns 403 when user lacks manage_provider_connections", async () => {
    mockAuth.mockResolvedValue({
      user: { platformRole: "HR-100", isSuperuser: false },
    });

    const res = await POST(makeReq({}));
    expect(res.status).toBe(403);
    expect(mockConnectQuickBooks).not.toHaveBeenCalled();
  });

  it("returns 400 on invalid JSON body", async () => {
    mockAuth.mockResolvedValue({
      user: { platformRole: "HR-000", isSuperuser: false },
    });

    const res = await POST(makeReq({}, { raw: "{not json" }));
    expect(res.status).toBe(400);
    expect(mockConnectQuickBooks).not.toHaveBeenCalled();
  });

  it("delegates to connectQuickBooks and returns 200 on success", async () => {
    mockAuth.mockResolvedValue({
      user: { platformRole: "HR-000", isSuperuser: false },
    });
    mockConnectQuickBooks.mockResolvedValue({
      ok: true,
      status: "connected",
      companyName: "Acme Services LLC",
      realmId: "9130355377388383",
      lastTestedAt: "2026-04-24T00:00:00.000Z",
    });

    const res = await POST(makeReq({ clientId: "c", clientSecret: "s" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "connected",
      companyName: "Acme Services LLC",
      realmId: "9130355377388383",
      lastTestedAt: "2026-04-24T00:00:00.000Z",
    });
  });

  it("returns the action statusCode on failure", async () => {
    mockAuth.mockResolvedValue({
      user: { platformRole: "HR-000", isSuperuser: false },
    });
    mockConnectQuickBooks.mockResolvedValue({
      ok: false,
      status: "error",
      error: "invalid QuickBooks credentials",
      statusCode: 400,
    });

    const res = await POST(makeReq({ clientId: "c" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "invalid QuickBooks credentials",
      status: "error",
    });
  });
});
