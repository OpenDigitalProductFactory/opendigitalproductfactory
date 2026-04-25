import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockConnectHubSpot } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockConnectHubSpot: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/integrate/hubspot/connect-action", () => ({
  connectHubSpot: mockConnectHubSpot,
}));

import { POST } from "./route";

function makeReq(body: unknown, options: { raw?: string } = {}): Request {
  const bodyText = options.raw !== undefined ? options.raw : JSON.stringify(body);
  return new Request("http://test/api/integrations/hubspot/connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: bodyText,
  });
}

beforeEach(() => {
  mockAuth.mockReset();
  mockConnectHubSpot.mockReset();
});

describe("POST /api/integrations/hubspot/connect", () => {
  it("returns 401 when no session", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(makeReq({}));
    expect(res.status).toBe(401);
    expect(mockConnectHubSpot).not.toHaveBeenCalled();
  });

  it("returns 403 when user lacks permission", async () => {
    mockAuth.mockResolvedValue({
      user: { platformRole: "HR-100", isSuperuser: false },
    });
    const res = await POST(makeReq({}));
    expect(res.status).toBe(403);
  });

  it("returns 400 on invalid JSON", async () => {
    mockAuth.mockResolvedValue({
      user: { platformRole: "HR-000", isSuperuser: false },
    });
    const res = await POST(makeReq({}, { raw: "{bad json" }));
    expect(res.status).toBe(400);
    expect(mockConnectHubSpot).not.toHaveBeenCalled();
  });

  it("returns 200 on success", async () => {
    mockAuth.mockResolvedValue({
      user: { platformRole: "HR-000", isSuperuser: false },
    });
    mockConnectHubSpot.mockResolvedValue({
      ok: true,
      status: "connected",
      portalId: 123456,
      accountType: "STANDARD",
      lastTestedAt: "2026-04-24T09:00:00.000Z",
    });

    const res = await POST(makeReq({ accessToken: "pat-na1-example-token" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "connected",
      portalId: 123456,
      accountType: "STANDARD",
      lastTestedAt: "2026-04-24T09:00:00.000Z",
    });
  });

  it("returns the action status code on failure", async () => {
    mockAuth.mockResolvedValue({
      user: { platformRole: "HR-000", isSuperuser: false },
    });
    mockConnectHubSpot.mockResolvedValue({
      ok: false,
      status: "error",
      error: "invalid HubSpot credentials",
      statusCode: 400,
    });

    const res = await POST(makeReq({ accessToken: "pat-na1-example-token" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      status: "error",
      error: "invalid HubSpot credentials",
    });
  });
});
