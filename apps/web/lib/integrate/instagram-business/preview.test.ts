import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindUnique, mockUpdate, mockProbeInstagramBusiness } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn(),
  mockProbeInstagramBusiness: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: { integrationCredential: { findUnique: mockFindUnique, update: mockUpdate } },
}));

vi.mock("@/lib/govern/credential-crypto", () => ({
  decryptJson: vi.fn((value: string) => JSON.parse(value)),
}));

vi.mock("./client", () => ({
  probeInstagramBusiness: mockProbeInstagramBusiness,
}));

import { loadInstagramBusinessPreview } from "./preview";

describe("loadInstagramBusinessPreview", () => {
  beforeEach(() => {
    mockFindUnique.mockReset();
    mockUpdate.mockReset();
    mockProbeInstagramBusiness.mockReset();
    mockUpdate.mockResolvedValue({});
  });

  it("returns unavailable when no credential exists", async () => {
    mockFindUnique.mockResolvedValue(null);
    await expect(loadInstagramBusinessPreview()).resolves.toEqual({ state: "unavailable" });
  });

  it("refreshes preview data and marks the credential connected", async () => {
    mockFindUnique.mockResolvedValue({
      integrationId: "instagram-business",
      fieldsEnc: JSON.stringify({
        accessToken: "meta-token",
        instagramBusinessAccountId: "ig-123",
      }),
    });
    mockProbeInstagramBusiness.mockResolvedValue({
      profile: { id: "ig-123", username: "acme_austin" },
      recentMedia: [{ id: "media-1", caption: "Austin appointments open." }],
      recentComments: [],
    });

    const result = await loadInstagramBusinessPreview();

    expect(result.state).toBe("available");
    if (result.state !== "available") throw new Error("expected available preview");
    expect(result.preview.profile.id).toBe("ig-123");
    expect(mockUpdate.mock.calls[0][0].data.status).toBe("connected");
  });
});
