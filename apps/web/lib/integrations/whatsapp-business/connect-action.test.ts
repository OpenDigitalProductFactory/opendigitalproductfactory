import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUpsert, mockProbeWhatsAppBusiness } = vi.hoisted(() => ({
  mockUpsert: vi.fn(),
  mockProbeWhatsAppBusiness: vi.fn(),
}));

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

vi.mock("./client", () => ({
  WhatsAppBusinessApiError: class WhatsAppBusinessApiError extends Error {},
  probeWhatsAppBusiness: mockProbeWhatsAppBusiness,
}));

import { connectWhatsAppBusiness } from "./connect-action";

describe("connectWhatsAppBusiness", () => {
  beforeEach(() => {
    mockUpsert.mockReset();
    mockProbeWhatsAppBusiness.mockReset();
    mockUpsert.mockResolvedValue({});
  });

  it("persists encrypted credentials and returns phone summary on success", async () => {
    mockProbeWhatsAppBusiness.mockResolvedValue({
      phoneNumber: {
        id: "phone-456",
        displayPhoneNumber: "+1 512-555-0100",
        verifiedName: "Acme Austin",
        qualityRating: "GREEN",
        codeVerificationStatus: "VERIFIED",
        platformType: "CLOUD_API",
      },
      templates: [],
      localeSummary: [],
    });

    const result = await connectWhatsAppBusiness({
      accessToken: "meta-token",
      wabaId: "waba-123",
      phoneNumberId: "phone-456",
    });

    expect(result.ok).toBe(true);
    expect(result).toMatchObject({
      status: "connected",
      wabaId: "waba-123",
      phoneNumberId: "phone-456",
      displayPhoneNumber: "+1 512-555-0100",
    });
    const call = mockUpsert.mock.calls[0][0];
    expect(call.where.integrationId).toBe("whatsapp-business");
    expect(call.create.provider).toBe("facebook");
    expect(call.create.status).toBe("connected");
  });

  it("stores error state when probing fails", async () => {
    mockProbeWhatsAppBusiness.mockRejectedValue(new Error("invalid WhatsApp Business access"));

    const result = await connectWhatsAppBusiness({
      accessToken: "meta-token",
      wabaId: "waba-123",
      phoneNumberId: "phone-456",
    });

    expect(result).toEqual({
      ok: false,
      status: "error",
      error: "invalid WhatsApp Business access",
      statusCode: 400,
    });
    expect(mockUpsert.mock.calls[0][0].create.status).toBe("error");
  });

  it("rejects invalid input before persistence", async () => {
    const result = await connectWhatsAppBusiness({
      accessToken: "",
      wabaId: "",
      phoneNumberId: "",
    });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      status: "error",
      statusCode: 400,
    });
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});
