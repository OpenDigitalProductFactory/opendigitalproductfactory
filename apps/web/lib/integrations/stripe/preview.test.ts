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
import { loadStripePreview } from "./preview";

describe("loadStripePreview", () => {
  beforeEach(() => {
    mockFindUnique.mockReset();
    mockUpdate.mockReset();
    mockUpdate.mockResolvedValue({});
  });

  it("returns a live Stripe operational preview and refreshes metadata", async () => {
    const now = new Date("2026-04-24T08:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    mockFindUnique.mockResolvedValue({
      integrationId: "stripe-billing-payments",
      provider: "stripe",
      status: "connected",
      fieldsEnc: encryptJson({
        secretKey: "sk_test_123",
        mode: "test",
      }),
      tokenCacheEnc: null,
    });

    const probeStripeAccount = vi.fn().mockResolvedValue({
      balance: {
        livemode: false,
        available: [{ amount: 275000, currency: "usd" }],
        pending: [{ amount: 12000, currency: "usd" }],
      },
      recentCustomers: [{ id: "cus_123", name: "Acme Managed IT", email: "billing@acme.example" }],
      recentInvoices: [{ id: "in_123", number: "INV-2026-001", status: "open", amount_due: 125000, currency: "usd" }],
      recentPaymentIntents: [{ id: "pi_123", amount: 125000, currency: "usd", status: "requires_payment_method", description: "Managed services retainer" }],
    });

    const result = await loadStripePreview({ probeStripeAccount });

    expect(result).toEqual({
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

    expect(probeStripeAccount).toHaveBeenCalledWith({ secretKey: "sk_test_123" });
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const call = mockUpdate.mock.calls[0][0];
    expect(call.where.integrationId).toBe("stripe-billing-payments");
    expect(call.data.status).toBe("connected");
    expect(call.data.lastErrorMsg).toBeNull();
    expect(call.data.lastTestedAt).toEqual(now);

    vi.useRealTimers();
  });

  it("returns unavailable when no Stripe credential exists", async () => {
    mockFindUnique.mockResolvedValue(null);

    const result = await loadStripePreview();

    expect(result).toEqual({ state: "unavailable" });
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
