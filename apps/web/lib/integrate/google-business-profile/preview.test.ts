import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindUnique, mockUpdate, mockExchangeGoogleRefreshToken, mockProbeGoogleBusinessProfile } =
  vi.hoisted(() => ({
    mockFindUnique: vi.fn(),
    mockUpdate: vi.fn(),
    mockExchangeGoogleRefreshToken: vi.fn(),
    mockProbeGoogleBusinessProfile: vi.fn(),
  }));

vi.mock("@dpf/db", () => ({
  prisma: {
    integrationCredential: {
      findUnique: mockFindUnique,
      update: mockUpdate,
    },
  },
}));

vi.mock("@/lib/govern/credential-crypto", () => ({
  decryptJson: vi.fn((value: string) => JSON.parse(value)),
  encryptJson: vi.fn((value: unknown) => JSON.stringify(value)),
}));

vi.mock("../google-marketing-intelligence/token-client", () => ({
  exchangeGoogleRefreshToken: mockExchangeGoogleRefreshToken,
}));

vi.mock("./client", () => ({
  probeGoogleBusinessProfile: mockProbeGoogleBusinessProfile,
}));

import { loadGoogleBusinessProfilePreview } from "./preview";

describe("loadGoogleBusinessProfilePreview", () => {
  beforeEach(() => {
    mockFindUnique.mockReset();
    mockUpdate.mockReset();
    mockExchangeGoogleRefreshToken.mockReset();
    mockProbeGoogleBusinessProfile.mockReset();
    mockUpdate.mockResolvedValue({});
  });

  it("returns unavailable when no credential has been configured", async () => {
    mockFindUnique.mockResolvedValue(null);

    await expect(loadGoogleBusinessProfilePreview()).resolves.toEqual({
      state: "unavailable",
    });
  });

  it("refreshes preview data and updates the credential state", async () => {
    mockFindUnique.mockResolvedValue({
      integrationId: "google-business-profile",
      fieldsEnc: JSON.stringify({
        clientId: "client-id",
        clientSecret: "client-secret",
        refreshToken: "refresh-token",
        accountId: "123",
        locationId: "456",
      }),
    });
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
      reviews: [
        {
          reviewId: "review-1",
          comment: "Fast response and great local support.",
        },
      ],
    });

    const result = await loadGoogleBusinessProfilePreview();

    expect(result.state).toBe("available");
    if (result.state !== "available") {
      throw new Error("expected available preview");
    }

    expect(result.preview.location.title).toBe("Acme MSP - Austin");
    expect(result.preview.reviews[0]?.reviewId).toBe("review-1");
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0][0].data.status).toBe("connected");
  });
});
