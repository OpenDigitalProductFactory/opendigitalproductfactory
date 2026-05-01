import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindUnique, mockUpdate, mockProbeWhatsAppBusiness } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn(),
  mockProbeWhatsAppBusiness: vi.fn(),
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
}));

vi.mock("./client", () => ({
  probeWhatsAppBusiness: mockProbeWhatsAppBusiness,
}));

import { loadWhatsAppBusinessPreview } from "./preview";

describe("loadWhatsAppBusinessPreview", () => {
  beforeEach(() => {
    mockFindUnique.mockReset();
    mockUpdate.mockReset();
    mockProbeWhatsAppBusiness.mockReset();
    mockUpdate.mockResolvedValue({});
  });

  it("returns unavailable when no credential exists", async () => {
    mockFindUnique.mockResolvedValue(null);
    await expect(loadWhatsAppBusinessPreview()).resolves.toEqual({ state: "unavailable" });
  });

  it("refreshes preview data and updates credential state", async () => {
    mockFindUnique.mockResolvedValue({
      integrationId: "whatsapp-business",
      fieldsEnc: JSON.stringify({
        accessToken: "meta-token",
        wabaId: "waba-123",
        phoneNumberId: "phone-456",
      }),
    });
    mockProbeWhatsAppBusiness.mockResolvedValue({
      phoneNumber: {
        id: "phone-456",
        displayPhoneNumber: "+1 512-555-0100",
        verifiedName: "Acme Austin",
        qualityRating: "GREEN",
        codeVerificationStatus: "VERIFIED",
        platformType: "CLOUD_API",
      },
      templates: [{ id: "template-1", name: "appointment_reminder", language: "en_US", status: "APPROVED" }],
      localeSummary: [{ language: "en_US", approved: 1, pending: 0, rejected: 0 }],
    });

    const result = await loadWhatsAppBusinessPreview();

    expect(result.state).toBe("available");
    if (result.state !== "available") throw new Error("expected available preview");
    expect(result.preview.phoneNumber.id).toBe("phone-456");
    expect(result.preview.localeSummary[0]?.language).toBe("en_US");
    expect(mockUpdate.mock.calls[0][0].data.status).toBe("connected");
  });
});
