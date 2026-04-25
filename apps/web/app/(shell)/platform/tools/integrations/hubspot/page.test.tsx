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

vi.mock("@/lib/integrate/hubspot/preview", () => ({
  loadHubSpotPreview: mockLoadPreview,
}));

vi.mock("@/components/integrations/HubSpotConnectPanel", () => ({
  HubSpotConnectPanel: ({
    initialState,
  }: {
    initialState: {
      status: string;
      portalId: number | null;
      accountType: string | null;
      lastErrorMsg: string | null;
      lastTestedAt: string | null;
    };
  }) => (
    <div
      data-component="hubspot-connect-panel"
      data-status={initialState.status}
      data-portal-id={initialState.portalId ?? ""}
      data-account-type={initialState.accountType ?? ""}
      data-last-tested={initialState.lastTestedAt ?? ""}
    />
  ),
}));

describe("HubSpotIntegrationPage", () => {
  it("renders live HubSpot preview data and refreshes the connection state", async () => {
    mockAuth.mockResolvedValue({
      user: { platformRole: "superadmin", isSuperuser: true },
    });
    mockCan.mockReturnValue(true);
    mockFindUnique.mockResolvedValue({
      integrationId: "hubspot-marketing-crm",
      status: "connected",
      lastErrorMsg: null,
      lastTestedAt: new Date("2026-04-24T09:00:00.000Z"),
      fieldsEnc: JSON.stringify({
        portalId: 123456,
        accountType: "STANDARD",
      }),
    });
    mockLoadPreview.mockResolvedValue({
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
        loadedAt: "2026-04-24T09:30:00.000Z",
      },
    });

    const { default: HubSpotIntegrationPage } = await import("./page");
    const html = renderToStaticMarkup(await HubSpotIntegrationPage());

    expect(mockLoadPreview).toHaveBeenCalledTimes(1);
    expect(html).toContain('data-component="hubspot-connect-panel"');
    expect(html).toContain('data-portal-id="123456"');
    expect(html).toContain('data-status="connected"');
    expect(html).toContain("Live marketing preview");
    expect(html).toContain("Contact Sales");
    expect(html).toContain("Newsletter");
    expect(html).toContain("avery@example.com");
    expect(html).toContain("app.hubspot.com");
  });
});
