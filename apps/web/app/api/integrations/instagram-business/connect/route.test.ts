import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockCan, mockConnectInstagramBusiness } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockCan: vi.fn(),
  mockConnectInstagramBusiness: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/permissions", () => ({ can: mockCan }));
vi.mock("@/lib/integrations/instagram-business/connect-action", () => ({
  connectInstagramBusiness: mockConnectInstagramBusiness,
}));

import { POST } from "./route";

describe("POST /api/integrations/instagram-business/connect", () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockCan.mockReset();
    mockConnectInstagramBusiness.mockReset();
  });

  it("returns unauthorized without a session", async () => {
    mockAuth.mockResolvedValue(null);

    const response = await POST(new Request("http://localhost", { method: "POST", body: "{}" }));

    expect(response.status).toBe(401);
  });

  it("connects Instagram Business credentials for authorized operators", async () => {
    mockAuth.mockResolvedValue({ user: { platformRole: "superadmin", isSuperuser: true } });
    mockCan.mockReturnValue(true);
    mockConnectInstagramBusiness.mockResolvedValue({
      ok: true,
      status: "connected",
      instagramBusinessAccountId: "ig-123",
      username: "acme_austin",
      lastTestedAt: "2026-05-01T12:00:00.000Z",
    });

    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          accessToken: "meta-token",
          instagramBusinessAccountId: "ig-123",
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      status: "connected",
      instagramBusinessAccountId: "ig-123",
      username: "acme_austin",
    });
  });
});
