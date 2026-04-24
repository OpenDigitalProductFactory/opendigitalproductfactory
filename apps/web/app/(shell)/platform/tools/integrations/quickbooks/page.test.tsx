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

vi.mock("@/lib/integrate/quickbooks/preview", () => ({
  loadQuickBooksPreview: mockLoadPreview,
}));

vi.mock("@/components/integrations/QuickBooksConnectPanel", () => ({
  QuickBooksConnectPanel: ({
    initialState,
  }: {
    initialState: {
      status: string;
      companyName: string | null;
      realmId: string | null;
      lastErrorMsg: string | null;
      lastTestedAt: string | null;
      environment: string | null;
    };
  }) => (
    <div
      data-component="quickbooks-connect-panel"
      data-status={initialState.status}
      data-company={initialState.companyName ?? ""}
      data-last-tested={initialState.lastTestedAt ?? ""}
    />
  ),
}));

describe("QuickBooksIntegrationPage", () => {
  it("renders live QuickBooks preview data and refreshes the connection state", async () => {
    mockAuth.mockResolvedValue({
      user: { platformRole: "superadmin", isSuperuser: true },
    });
    mockCan.mockReturnValue(true);
    mockFindUnique.mockResolvedValue({
      integrationId: "quickbooks-online-accounting",
      status: "connected",
      lastErrorMsg: null,
      lastTestedAt: new Date("2026-04-24T05:00:00.000Z"),
      fieldsEnc: JSON.stringify({
        companyName: "Old Company",
        realmId: "9130355377388383",
        environment: "sandbox",
      }),
    });
    mockLoadPreview.mockResolvedValue({
      state: "available",
      preview: {
        companyInfo: { CompanyName: "Acme Services LLC", Country: "US" },
        sampleCustomer: { Id: "42", DisplayName: "Acme Managed IT" },
        sampleInvoice: { Id: "9001", DocNumber: "INV-9001" },
        loadedAt: "2026-04-24T06:00:00.000Z",
      },
    });

    const { default: QuickBooksIntegrationPage } = await import("./page");
    const html = renderToStaticMarkup(await QuickBooksIntegrationPage());

    expect(mockLoadPreview).toHaveBeenCalledTimes(1);
    expect(html).toContain('data-component="quickbooks-connect-panel"');
    expect(html).toContain('data-company="Acme Services LLC"');
    expect(html).toContain('data-status="connected"');
    expect(html).toContain("Live accounting preview");
    expect(html).toContain("Acme Services LLC");
    expect(html).toContain("Acme Managed IT");
    expect(html).toContain("INV-9001");
  });
});
