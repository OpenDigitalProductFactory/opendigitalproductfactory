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
import { loadHubSpotPreview } from "./preview";

describe("loadHubSpotPreview", () => {
  beforeEach(() => {
    mockFindUnique.mockReset();
    mockUpdate.mockReset();
    mockUpdate.mockResolvedValue({});
  });

  it("returns a live HubSpot marketing preview and refreshes metadata", async () => {
    const now = new Date("2026-04-24T09:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    mockFindUnique.mockResolvedValue({
      integrationId: "hubspot-marketing-crm",
      provider: "hubspot",
      status: "connected",
      fieldsEnc: encryptJson({
        accessToken: "pat-na1-example-token",
        portalId: 123456,
        accountType: "STANDARD",
      }),
      tokenCacheEnc: null,
    });

    const probeHubSpotPortal = vi.fn().mockResolvedValue({
      account: {
        portalId: 123456,
        accountType: "STANDARD",
        companyCurrency: "USD",
        timeZone: "US/Central",
        uiDomain: "app.hubspot.com",
      },
      recentContacts: [
        { id: "1", properties: { firstname: "Avery", lastname: "Shaw", email: "avery@example.com" } },
        { id: "2", properties: { firstname: "Jordan", lastname: "Lee", email: "jordan@example.com" } },
      ],
      recentForms: [
        { guid: "form-1", name: "Contact Sales", formType: "hubspot" },
        { guid: "form-2", name: "Newsletter", formType: "captured" },
      ],
    });

    const result = await loadHubSpotPreview({ probeHubSpotPortal });

    expect(result).toEqual({
      state: "available",
      preview: {
        account: {
          portalId: 123456,
          accountType: "STANDARD",
          companyCurrency: "USD",
          timeZone: "US/Central",
          uiDomain: "app.hubspot.com",
        },
        recentContacts: [
          { id: "1", properties: { firstname: "Avery", lastname: "Shaw", email: "avery@example.com" } },
          { id: "2", properties: { firstname: "Jordan", lastname: "Lee", email: "jordan@example.com" } },
        ],
        recentForms: [
          { guid: "form-1", name: "Contact Sales", formType: "hubspot" },
          { guid: "form-2", name: "Newsletter", formType: "captured" },
        ],
        loadedAt: "2026-04-24T09:00:00.000Z",
      },
    });

    expect(probeHubSpotPortal).toHaveBeenCalledWith({ accessToken: "pat-na1-example-token" });
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const call = mockUpdate.mock.calls[0][0];
    expect(call.where.integrationId).toBe("hubspot-marketing-crm");
    expect(call.data.status).toBe("connected");
    expect(call.data.lastErrorMsg).toBeNull();
    expect(call.data.lastTestedAt).toEqual(now);

    vi.useRealTimers();
  });

  it("returns unavailable when no HubSpot credential exists", async () => {
    mockFindUnique.mockResolvedValue(null);

    const result = await loadHubSpotPreview();

    expect(result).toEqual({ state: "unavailable" });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns an error state and persists lastError when refresh fails", async () => {
    const now = new Date("2026-04-24T09:15:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    mockFindUnique.mockResolvedValue({
      integrationId: "hubspot-marketing-crm",
      provider: "hubspot",
      status: "connected",
      fieldsEnc: encryptJson({
        accessToken: "pat-na1-example-token",
      }),
      tokenCacheEnc: null,
    });

    const result = await loadHubSpotPreview({
      probeHubSpotPortal: vi.fn().mockRejectedValue(new Error("invalid HubSpot credentials")),
    });

    expect(result).toEqual({
      state: "error",
      error: "invalid HubSpot credentials",
    });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const call = mockUpdate.mock.calls[0][0];
    expect(call.data.status).toBe("error");
    expect(call.data.lastErrorMsg).toBe("invalid HubSpot credentials");
    expect(call.data.lastErrorAt).toEqual(now);

    vi.useRealTimers();
  });
});
