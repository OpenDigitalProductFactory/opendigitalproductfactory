import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindUnique, mockUpdate } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    integrationCredential: {
      findUnique: mockFindUnique,
      update: mockUpdate,
    },
  },
}));

import { encryptJson } from "@/lib/govern/credential-crypto";
import { loadGoogleMarketingPreview } from "./preview";

describe("loadGoogleMarketingPreview", () => {
  beforeEach(() => {
    mockFindUnique.mockReset();
    mockUpdate.mockReset();
    mockUpdate.mockResolvedValue({});
  });

  it("refreshes the stored Google token and returns GA4/Search Console preview data", async () => {
    const now = new Date("2026-04-24T10:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    mockFindUnique.mockResolvedValue({
      integrationId: "google-marketing-intelligence",
      provider: "google",
      status: "connected",
      fieldsEnc: encryptJson({
        clientId: "google-client-id",
        clientSecret: "google-client-secret",
        refreshToken: "google-refresh-token",
        ga4PropertyId: "123456",
        searchConsoleSiteUrl: "sc-domain:example.com",
      }),
      tokenCacheEnc: null,
    });

    const exchangeGoogleRefreshToken = vi.fn().mockResolvedValue({
      accessToken: "google-access-token",
      tokenType: "Bearer",
      expiresAt: new Date("2026-04-24T11:00:00.000Z"),
      scope: "https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/webmasters.readonly",
    });

    const probeGoogleMarketingIntelligence = vi.fn().mockResolvedValue({
      analyticsSummary: {
        sessions: 1200,
        totalUsers: 840,
        conversions: 48,
      },
      searchConsoleRows: [
        { keys: ["/managed-services", "managed it services"], clicks: 82, impressions: 1300, ctr: 0.063, position: 7.4 },
        { keys: ["/cybersecurity", "cybersecurity support"], clicks: 49, impressions: 910, ctr: 0.053, position: 9.2 },
      ],
    });

    const result = await loadGoogleMarketingPreview({
      exchangeGoogleRefreshToken,
      probeGoogleMarketingIntelligence,
    });

    expect(result).toEqual({
      state: "available",
      preview: {
        analyticsSummary: {
          sessions: 1200,
          totalUsers: 840,
          conversions: 48,
        },
        searchConsoleRows: [
          { keys: ["/managed-services", "managed it services"], clicks: 82, impressions: 1300, ctr: 0.063, position: 7.4 },
          { keys: ["/cybersecurity", "cybersecurity support"], clicks: 49, impressions: 910, ctr: 0.053, position: 9.2 },
        ],
        loadedAt: "2026-04-24T10:00:00.000Z",
      },
    });

    expect(exchangeGoogleRefreshToken).toHaveBeenCalledWith({
      clientId: "google-client-id",
      clientSecret: "google-client-secret",
      refreshToken: "google-refresh-token",
    });
    expect(probeGoogleMarketingIntelligence).toHaveBeenCalledWith({
      accessToken: "google-access-token",
      ga4PropertyId: "123456",
      searchConsoleSiteUrl: "sc-domain:example.com",
    });
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const call = mockUpdate.mock.calls[0][0];
    expect(call.where.integrationId).toBe("google-marketing-intelligence");
    expect(call.data.status).toBe("connected");
    expect(call.data.lastErrorMsg).toBeNull();
    expect(call.data.lastTestedAt).toEqual(now);

    vi.useRealTimers();
  });

  it("returns unavailable when no Google marketing credential exists", async () => {
    mockFindUnique.mockResolvedValue(null);

    const result = await loadGoogleMarketingPreview();

    expect(result).toEqual({ state: "unavailable" });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns an error state and persists lastError when refresh fails", async () => {
    const now = new Date("2026-04-24T10:15:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    mockFindUnique.mockResolvedValue({
      integrationId: "google-marketing-intelligence",
      provider: "google",
      status: "connected",
      fieldsEnc: encryptJson({
        clientId: "google-client-id",
        clientSecret: "google-client-secret",
        refreshToken: "google-refresh-token",
        ga4PropertyId: "123456",
        searchConsoleSiteUrl: "sc-domain:example.com",
      }),
      tokenCacheEnc: null,
    });

    const result = await loadGoogleMarketingPreview({
      exchangeGoogleRefreshToken: vi.fn().mockRejectedValue(new Error("invalid Google credentials")),
      probeGoogleMarketingIntelligence: vi.fn(),
    });

    expect(result).toEqual({
      state: "error",
      error: "invalid Google credentials",
    });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const call = mockUpdate.mock.calls[0][0];
    expect(call.data.status).toBe("error");
    expect(call.data.lastErrorMsg).toBe("invalid Google credentials");
    expect(call.data.lastErrorAt).toEqual(now);

    vi.useRealTimers();
  });
});
