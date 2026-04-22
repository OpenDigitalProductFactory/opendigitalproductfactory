import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockConnectAdp } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockConnectAdp: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/integrate/adp/connect-action", () => ({ connectAdp: mockConnectAdp }));

import { POST } from "./route";

function makeReq(body: unknown, options: { raw?: string } = {}): Request {
  const bodyText = options.raw !== undefined ? options.raw : JSON.stringify(body);
  return new Request("http://test/api/integrations/adp/connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: bodyText,
  });
}

beforeEach(() => {
  mockAuth.mockReset();
  mockConnectAdp.mockReset();
});

describe("POST /api/integrations/adp/connect", () => {
  it("returns 401 when no session", async () => {
    mockAuth.mockResolvedValue(null);

    const res = await POST(makeReq({}));
    expect(res.status).toBe(401);
    expect(mockConnectAdp).not.toHaveBeenCalled();
  });

  it("returns 403 when user lacks manage_provider_connections", async () => {
    mockAuth.mockResolvedValue({
      user: { platformRole: "HR-100", isSuperuser: false },
    });

    const res = await POST(makeReq({}));
    expect(res.status).toBe(403);
    expect(mockConnectAdp).not.toHaveBeenCalled();
  });

  it("returns 400 on invalid JSON body", async () => {
    mockAuth.mockResolvedValue({
      user: { platformRole: "HR-000", isSuperuser: false },
    });

    const res = await POST(makeReq({}, { raw: "{not json" }));
    expect(res.status).toBe(400);
    expect(mockConnectAdp).not.toHaveBeenCalled();
  });

  it("delegates to connectAdp and returns 200 on success", async () => {
    mockAuth.mockResolvedValue({
      user: { platformRole: "HR-000", isSuperuser: false },
    });
    mockConnectAdp.mockResolvedValue({
      ok: true,
      status: "connected",
      certExpiresAt: "2027-04-21T00:00:00.000Z",
    });

    const res = await POST(makeReq({ clientId: "c", clientSecret: "s" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ status: "connected", certExpiresAt: "2027-04-21T00:00:00.000Z" });
    expect(mockConnectAdp).toHaveBeenCalledOnce();
  });

  it("returns the error statusCode from connectAdp on failure", async () => {
    mockAuth.mockResolvedValue({
      user: { platformRole: "HR-000", isSuperuser: false },
    });
    mockConnectAdp.mockResolvedValue({
      ok: false,
      status: "error",
      error: "certificate unreadable — check the PEM you pasted",
      statusCode: 400,
    });

    const res = await POST(makeReq({ clientId: "c" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({
      error: "certificate unreadable — check the PEM you pasted",
      status: "error",
    });
  });

  it("allows superusers regardless of platformRole", async () => {
    mockAuth.mockResolvedValue({
      user: { platformRole: null, isSuperuser: true },
    });
    mockConnectAdp.mockResolvedValue({
      ok: true,
      status: "connected",
      certExpiresAt: "2027-04-21T00:00:00.000Z",
    });

    const res = await POST(makeReq({}));
    expect(res.status).toBe(200);
    expect(mockConnectAdp).toHaveBeenCalledOnce();
  });
});
