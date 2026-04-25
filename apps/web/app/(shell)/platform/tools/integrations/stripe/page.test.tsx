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

vi.mock("@/lib/integrate/stripe/preview", () => ({
  loadStripePreview: mockLoadPreview,
}));

vi.mock("@/components/integrations/StripeConnectPanel", () => ({
  StripeConnectPanel: ({
    initialState,
  }: {
    initialState: {
      status: string;
      mode: string | null;
      lastErrorMsg: string | null;
      lastTestedAt: string | null;
    };
  }) => (
    <div
      data-component="stripe-connect-panel"
      data-status={initialState.status}
      data-mode={initialState.mode ?? ""}
      data-last-tested={initialState.lastTestedAt ?? ""}
    />
  ),
}));

describe("StripeIntegrationPage", () => {
  it("renders Stripe balance and recent payment activity", async () => {
    mockAuth.mockResolvedValue({
      user: { platformRole: "superadmin", isSuperuser: true },
    });
    mockCan.mockReturnValue(true);
    mockFindUnique.mockResolvedValue({
      integrationId: "stripe-billing-payments",
      status: "connected",
      lastErrorMsg: null,
      lastTestedAt: new Date("2026-04-24T07:30:00.000Z"),
      fieldsEnc: JSON.stringify({
        mode: "test",
      }),
    });
    mockLoadPreview.mockResolvedValue({
      state: "available",
      preview: {
        balance: {
          livemode: false,
          available: [{ amount: 275000, currency: "usd" }],
          pending: [{ amount: 12000, currency: "usd" }],
        },
        recentCustomers: [{ id: "cus_123", name: "Acme Managed IT", email: "billing@acme.example" }],
        recentInvoices: [{ id: "in_123", number: "INV-2026-001", status: "open", amount_due: 125000, currency: "usd" }],
        recentPaymentIntents: [{ id: "pi_123", amount: 125000, currency: "usd", status: "requires_payment_method", description: "Managed services retainer" }],
        loadedAt: "2026-04-24T08:00:00.000Z",
      },
    });

    const { default: StripeIntegrationPage } = await import("./page");
    const html = renderToStaticMarkup(await StripeIntegrationPage());

    expect(mockLoadPreview).toHaveBeenCalledTimes(1);
    expect(html).toContain('data-component="stripe-connect-panel"');
    expect(html).toContain('data-status="connected"');
    expect(html).toContain("Stripe Billing &amp; Payments");
    expect(html).toContain("Available balance");
    expect(html).toContain("Acme Managed IT");
    expect(html).toContain("INV-2026-001");
    expect(html).toContain("Managed services retainer");
  });
});
