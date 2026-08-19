import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockCan, mockConnectWhatsAppBusiness } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockCan: vi.fn(),
  mockConnectWhatsAppBusiness: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: mockAuth,
}));

vi.mock("@/lib/permissions", () => ({
  can: mockCan,
}));

vi.mock("@/lib/integrations/whatsapp-business/connect-action", () => ({
  connectWhatsAppBusiness: mockConnectWhatsAppBusiness,
}));

import { POST } from "./route";

describe("POST /api/integrations/whatsapp-business/connect", () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockCan.mockReset();
    mockConnectWhatsAppBusiness.mockReset();
  });

  it("returns unauthorized without a session", async () => {
    mockAuth.mockResolvedValue(null);

    const response = await POST(new Request("http://localhost", { method: "POST", body: "{}" }));

    expect(response.status).toBe(401);
  });

  it("connects WhatsApp Business credentials for authorized operators", async () => {
    mockAuth.mockResolvedValue({ user: { platformRole: "superadmin", isSuperuser: true } });
    mockCan.mockReturnValue(true);
    mockConnectWhatsAppBusiness.mockResolvedValue({
      ok: true,
      status: "connected",
      wabaId: "waba-123",
      phoneNumberId: "phone-456",
      displayPhoneNumber: "+1 512-555-0100",
      lastTestedAt: "2026-05-01T12:00:00.000Z",
    });

    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          accessToken: "meta-token",
          wabaId: "waba-123",
          phoneNumberId: "phone-456",
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      status: "connected",
      phoneNumberId: "phone-456",
      displayPhoneNumber: "+1 512-555-0100",
    });
  });
});
