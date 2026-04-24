import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockConnectGoogleMarketingIntelligence } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockConnectGoogleMarketingIntelligence: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/integrate/google-marketing-intelligence/connect-action", () => ({
  connectGoogleMarketingIntelligence: mockConnectGoogleMarketingIntelligence,
}));

import { POST } from "./route";

function makeReq(body: unknown, options: { raw?: string } = {}): Request {
  const bodyText = options.raw !== undefined ? options.raw : JSON.stringify(body);
  return new Request("http://test/api/integrations/google-marketing-intelligence/connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: bodyText,
  });
}

beforeEach(() => {
  mockAuth.mockReset();
  mockConnectGoogleMarketingIntelligence.mockReset();
});

describe("POST /api/integrations/google-marketing-intelligence/connect", () => {
  it("returns 401 when no session", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(makeReq({}));
    expect(res.status).toBe(401);
    expect(mockConnectGoogleMarketingIntelligence).not.toHaveBeenCalled();
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
    expect(mockConnectGoogleMarketingIntelligence).not.toHaveBeenCalled();
  });

  it("returns 200 on success", async () => {
    mockAuth.mockResolvedValue({
      user: { platformRole: "HR-000", isSuperuser: false },
    });
    mockConnectGoogleMarketingIntelligence.mockResolvedValue({
      ok: true,
      status: "connected",
      ga4PropertyId: "123456",
      searchConsoleSiteUrl: "sc-domain:example.com",
      lastTestedAt: "2026-04-24T10:00:00.000Z",
    });

    const res = await POST(
      makeReq({
        clientId: "google-client-id",
        clientSecret: "google-client-secret",
        refreshToken: "google-refresh-token",
        ga4PropertyId: "123456",
        searchConsoleSiteUrl: "sc-domain:example.com",
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "connected",
      ga4PropertyId: "123456",
      searchConsoleSiteUrl: "sc-domain:example.com",
      lastTestedAt: "2026-04-24T10:00:00.000Z",
    });
  });

  it("returns the action status code on failure", async () => {
    mockAuth.mockResolvedValue({
      user: { platformRole: "HR-000", isSuperuser: false },
    });
    mockConnectGoogleMarketingIntelligence.mockResolvedValue({
      ok: false,
      status: "error",
      error: "invalid Google credentials",
      statusCode: 400,
    });

    const res = await POST(makeReq({ clientId: "google-client-id" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      status: "error",
      error: "invalid Google credentials",
    });
  });
});
