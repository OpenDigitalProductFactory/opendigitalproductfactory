import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUpsert, mockExchangeGoogleRefreshToken, mockProbeGoogleBusinessProfile } = vi.hoisted(
  () => ({
    mockUpsert: vi.fn(),
    mockExchangeGoogleRefreshToken: vi.fn(),
    mockProbeGoogleBusinessProfile: vi.fn(),
  }),
);

vi.mock("@dpf/db", () => ({
  prisma: {
    integrationCredential: {
      upsert: mockUpsert,
    },
  },
}));

vi.mock("@/lib/govern/credential-crypto", () => ({
  encryptJson: vi.fn((value: unknown) => JSON.stringify(value)),
}));

vi.mock("../google-marketing-intelligence/token-client", () => ({
  GoogleMarketingAuthError: class GoogleMarketingAuthError extends Error {},
  exchangeGoogleRefreshToken: mockExchangeGoogleRefreshToken,
}));

vi.mock("./client", () => ({
  GoogleBusinessProfileApiError: class GoogleBusinessProfileApiError extends Error {},
  probeGoogleBusinessProfile: mockProbeGoogleBusinessProfile,
}));

import { connectGoogleBusinessProfile } from "./connect-action";

describe("connectGoogleBusinessProfile", () => {
  beforeEach(() => {
    mockUpsert.mockReset();
    mockExchangeGoogleRefreshToken.mockReset();
    mockProbeGoogleBusinessProfile.mockReset();
    mockUpsert.mockResolvedValue({});
  });

  it("persists encrypted credentials and returns the connected location summary on success", async () => {
    mockExchangeGoogleRefreshToken.mockResolvedValue({
      accessToken: "google-access-token",
      tokenType: "Bearer",
      expiresAt: new Date("2026-04-24T20:00:00.000Z"),
      scope: "https://www.googleapis.com/auth/business.manage",
    });
    mockProbeGoogleBusinessProfile.mockResolvedValue({
      account: {
        name: "accounts/123",
        accountName: "Acme Managed Services",
      },
      location: {
        name: "locations/456",
        title: "Acme MSP - Austin",
      },
      reviews: [],
    });

    const result = await connectGoogleBusinessProfile({
      clientId: "client-id",
      clientSecret: "client-secret",
      refreshToken: "refresh-token",
      accountId: "123",
      locationId: "456",
    });

    expect(result.ok).toBe(true);
    expect(result).toMatchObject({
      status: "connected",
      accountId: "123",
      locationId: "456",
      locationTitle: "Acme MSP - Austin",
    });

    const call = mockUpsert.mock.calls[0][0];
    expect(call.where.integrationId).toBe("google-business-profile");
    expect(call.create.provider).toBe("google");
    expect(call.create.status).toBe("connected");
    expect(call.update.lastErrorMsg).toBeNull();
  });

  it("stores error state when probing fails", async () => {
    mockExchangeGoogleRefreshToken.mockResolvedValue({
      accessToken: "google-access-token",
      tokenType: "Bearer",
      expiresAt: new Date("2026-04-24T20:00:00.000Z"),
      scope: "https://www.googleapis.com/auth/business.manage",
    });
    mockProbeGoogleBusinessProfile.mockRejectedValue(
      new Error("Google Business Profile API access has not been approved for this project"),
    );

    const result = await connectGoogleBusinessProfile({
      clientId: "client-id",
      clientSecret: "client-secret",
      refreshToken: "refresh-token",
      accountId: "123",
      locationId: "456",
    });

    expect(result).toEqual({
      ok: false,
      status: "error",
      error: "Google Business Profile API access has not been approved for this project",
      statusCode: 400,
    });
    expect(mockUpsert.mock.calls[0][0].create.status).toBe("error");
  });

  it("rejects invalid input before persistence", async () => {
    const result = await connectGoogleBusinessProfile({
      clientId: "",
      clientSecret: "",
      refreshToken: "",
      accountId: "",
      locationId: "",
    });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      status: "error",
      statusCode: 400,
    });
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockExchangeGoogleRefreshToken).not.toHaveBeenCalled();
    expect(mockProbeGoogleBusinessProfile).not.toHaveBeenCalled();
  });
});
