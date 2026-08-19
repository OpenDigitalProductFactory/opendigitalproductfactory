import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { mockFindUnique, mockLoadPreview, mockAuth, mockCan } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockLoadPreview: vi.fn(),
  mockAuth: vi.fn(),
  mockCan: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    integrationCredential: {
      findUnique: mockFindUnique,
    },
  },
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((target: string) => {
    throw new Error(`redirect:${target}`);
  }),
}));

vi.mock("@/lib/auth", () => ({
  auth: mockAuth,
}));

vi.mock("@/lib/permissions", () => ({
  can: mockCan,
}));

vi.mock("@/lib/govern/credential-crypto", () => ({
  decryptJson: vi.fn((value: string) => JSON.parse(value)),
}));

vi.mock("@/lib/integrations/whatsapp-business/preview", () => ({
  loadWhatsAppBusinessPreview: mockLoadPreview,
}));

vi.mock("@/components/integrations/WhatsAppBusinessConnectPanel", () => ({
  WhatsAppBusinessConnectPanel: ({
    initialState,
  }: {
    initialState: {
      status: string;
      wabaId: string | null;
      phoneNumberId: string | null;
      displayPhoneNumber: string | null;
    };
  }) => (
    <div
      data-component="whatsapp-business-connect-panel"
      data-status={initialState.status}
      data-waba-id={initialState.wabaId ?? ""}
      data-phone-number-id={initialState.phoneNumberId ?? ""}
      data-display-phone-number={initialState.displayPhoneNumber ?? ""}
    />
  ),
}));

describe("WhatsAppBusinessPage", () => {
  it("renders phone readiness and localized template preview", async () => {
    mockAuth.mockResolvedValue({
      user: { platformRole: "superadmin", isSuperuser: true },
    });
    mockCan.mockReturnValue(true);
    mockFindUnique.mockResolvedValue({
      integrationId: "whatsapp-business",
      status: "connected",
      lastErrorMsg: null,
      lastTestedAt: new Date("2026-05-01T11:00:00.000Z"),
      fieldsEnc: JSON.stringify({
        wabaId: "waba-123",
        phoneNumberId: "phone-456",
        displayPhoneNumber: "+1 512-555-0100",
      }),
    });
    mockLoadPreview.mockResolvedValue({
      state: "available",
      preview: {
        phoneNumber: {
          id: "phone-456",
          displayPhoneNumber: "+1 512-555-0100",
          verifiedName: "Acme Austin",
          qualityRating: "GREEN",
          codeVerificationStatus: "VERIFIED",
          platformType: "CLOUD_API",
        },
        templates: [
          {
            id: "template-1",
            name: "appointment_reminder",
            language: "en_US",
            status: "APPROVED",
            category: "UTILITY",
            bodyText: "Reminder for {{1}}",
          },
        ],
        localeSummary: [{ language: "en_US", approved: 1, pending: 0, rejected: 0 }],
        loadedAt: "2026-05-01T11:45:00.000Z",
      },
    });

    const { default: WhatsAppBusinessPage } = await import("./page");
    const html = renderToStaticMarkup(await WhatsAppBusinessPage());

    expect(mockLoadPreview).toHaveBeenCalledTimes(1);
    expect(html).toContain('data-component="whatsapp-business-connect-panel"');
    expect(html).toContain("Live WhatsApp readiness");
    expect(html).toContain("+1 512-555-0100");
    expect(html).toContain("appointment_reminder");
    expect(html).toContain("en_US");
  });
});
