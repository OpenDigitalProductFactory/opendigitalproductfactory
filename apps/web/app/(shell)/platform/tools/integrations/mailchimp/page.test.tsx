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

vi.mock("@/lib/integrate/mailchimp/preview", () => ({
  loadMailchimpPreview: mockLoadPreview,
}));

vi.mock("@/components/integrations/MailchimpConnectPanel", () => ({
  MailchimpConnectPanel: ({
    initialState,
  }: {
    initialState: {
      status: string;
      serverPrefix: string | null;
      accountName: string | null;
      lastErrorMsg: string | null;
      lastTestedAt: string | null;
    };
  }) => (
    <div
      data-component="mailchimp-connect-panel"
      data-status={initialState.status}
      data-server-prefix={initialState.serverPrefix ?? ""}
      data-account-name={initialState.accountName ?? ""}
    />
  ),
}));

describe("MailchimpIntegrationPage", () => {
  it("renders audiences and campaigns from the live preview", async () => {
    mockAuth.mockResolvedValue({
      user: { platformRole: "superadmin", isSuperuser: true },
    });
    mockCan.mockReturnValue(true);
    mockFindUnique.mockResolvedValue({
      integrationId: "mailchimp-marketing",
      status: "connected",
      lastErrorMsg: null,
      lastTestedAt: new Date("2026-04-24T11:00:00.000Z"),
      fieldsEnc: JSON.stringify({
        serverPrefix: "us21",
        accountName: "Acme Growth",
      }),
    });
    mockLoadPreview.mockResolvedValue({
      state: "available",
      preview: {
        account: { accountName: "Acme Growth" },
        audiences: [{ id: "list-1", name: "Austin Leads", stats: { member_count: 42 } }],
        campaigns: [{ id: "cmp-1", status: "save", settings: { title: "April Follow-up" } }],
        loadedAt: "2026-04-24T11:30:00.000Z",
      },
    });

    const { default: MailchimpIntegrationPage } = await import("./page");
    const html = renderToStaticMarkup(await MailchimpIntegrationPage());

    expect(mockLoadPreview).toHaveBeenCalledTimes(1);
    expect(html).toContain('data-component="mailchimp-connect-panel"');
    expect(html).toContain("Live marketing preview");
    expect(html).toContain("Austin Leads");
    expect(html).toContain("April Follow-up");
  });
});
