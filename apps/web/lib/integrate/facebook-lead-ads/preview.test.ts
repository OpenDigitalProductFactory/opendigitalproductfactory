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
import { loadFacebookLeadAdsPreview } from "./preview";

describe("loadFacebookLeadAdsPreview", () => {
  beforeEach(() => {
    mockFindUnique.mockReset();
    mockUpdate.mockReset();
    mockUpdate.mockResolvedValue({});
  });

  it("returns live lead forms and recent leads from the stored credential", async () => {
    const now = new Date("2026-04-24T11:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    mockFindUnique.mockResolvedValue({
      integrationId: "facebook-lead-ads",
      provider: "facebook",
      status: "connected",
      fieldsEnc: encryptJson({
        accessToken: "meta-token",
        pageId: "123456789",
      }),
      tokenCacheEnc: null,
    });

    const probeFacebookLeadAds = vi.fn().mockResolvedValue({
      page: {
        id: "123456789",
        name: "Acme Managed Services",
        category: "Business Service",
      },
      forms: [
        {
          id: "form-1",
          name: "Downtown Managed IT Consult",
          status: "ACTIVE",
          locale: "en_US",
          createdTime: "2026-04-20T15:00:00.000Z",
        },
      ],
      recentLeads: [
        {
          id: "lead-1",
          createdTime: "2026-04-24T15:00:00.000Z",
          adId: "ad-100",
          formId: "form-1",
        },
      ],
    });

    const result = await loadFacebookLeadAdsPreview({
      probeFacebookLeadAds,
    });

    expect(result).toEqual({
      state: "available",
      preview: {
        page: {
          id: "123456789",
          name: "Acme Managed Services",
          category: "Business Service",
        },
        forms: [
          {
            id: "form-1",
            name: "Downtown Managed IT Consult",
            status: "ACTIVE",
            locale: "en_US",
            createdTime: "2026-04-20T15:00:00.000Z",
          },
        ],
        recentLeads: [
          {
            id: "lead-1",
            createdTime: "2026-04-24T15:00:00.000Z",
            adId: "ad-100",
            formId: "form-1",
          },
        ],
        loadedAt: "2026-04-24T11:00:00.000Z",
      },
    });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0][0].data.status).toBe("connected");
    vi.useRealTimers();
  });

  it("returns unavailable when no Facebook credential exists", async () => {
    mockFindUnique.mockResolvedValue(null);

    const result = await loadFacebookLeadAdsPreview();

    expect(result).toEqual({ state: "unavailable" });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns error state and persists failure details", async () => {
    const now = new Date("2026-04-24T11:15:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    mockFindUnique.mockResolvedValue({
      integrationId: "facebook-lead-ads",
      provider: "facebook",
      status: "connected",
      fieldsEnc: encryptJson({
        accessToken: "meta-token",
        pageId: "123456789",
      }),
      tokenCacheEnc: null,
    });

    const result = await loadFacebookLeadAdsPreview({
      probeFacebookLeadAds: vi.fn().mockRejectedValue(new Error("page access token expired")),
    });

    expect(result).toEqual({
      state: "error",
      error: "page access token expired",
    });
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0][0].data.status).toBe("error");
    expect(mockUpdate.mock.calls[0][0].data.lastErrorMsg).toBe("page access token expired");
    vi.useRealTimers();
  });
});
