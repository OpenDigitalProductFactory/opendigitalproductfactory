import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockConnectGoogleBusinessProfile } = vi.hoisted(() => ({
  mockConnectGoogleBusinessProfile: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { platformRole: "superadmin", isSuperuser: true },
  })),
}));

vi.mock("@/lib/integrate/google-business-profile/connect-action", () => ({
  connectGoogleBusinessProfile: mockConnectGoogleBusinessProfile,
}));

function createRequest(body: unknown) {
  return new Request("http://test/api/integrations/google-business-profile/connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/integrations/google-business-profile/connect", () => {
  beforeEach(() => {
    mockConnectGoogleBusinessProfile.mockReset();
  });

  it("returns a connected response when the connect action succeeds", async () => {
    mockConnectGoogleBusinessProfile.mockResolvedValue({
      ok: true,
      status: "connected",
      accountId: "123",
      locationId: "456",
      locationTitle: "Acme MSP - Austin",
      lastTestedAt: "2026-04-24T20:00:00.000Z",
    });

    const { POST } = await import("./route");
    const response = await POST(
      createRequest({
        clientId: "client-id",
        clientSecret: "client-secret",
        refreshToken: "refresh-token",
        accountId: "123",
        locationId: "456",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "connected",
      locationId: "456",
    });
  });

  it("returns an error response when the connect action fails", async () => {
    mockConnectGoogleBusinessProfile.mockResolvedValue({
      ok: false,
      status: "error",
      error: "invalid Google credentials",
      statusCode: 400,
    });

    const { POST } = await import("./route");
    const response = await POST(createRequest({}));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid Google credentials",
    });
  });
});
