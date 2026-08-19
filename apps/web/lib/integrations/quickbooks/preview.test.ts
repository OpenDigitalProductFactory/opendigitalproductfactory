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
import { loadQuickBooksPreview } from "./preview";

describe("loadQuickBooksPreview", () => {
  beforeEach(() => {
    mockFindUnique.mockReset();
    mockUpdate.mockReset();
    mockUpdate.mockResolvedValue({});
  });

  it("refreshes the stored QuickBooks token and returns company/customer/invoice preview data", async () => {
    const now = new Date("2026-04-24T06:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    mockFindUnique.mockResolvedValue({
      integrationId: "quickbooks-online-accounting",
      provider: "quickbooks",
      status: "connected",
      fieldsEnc: encryptJson({
        clientId: "client-id",
        clientSecret: "client-secret",
        refreshToken: "refresh-token-123",
        realmId: "9130355377388383",
        environment: "sandbox",
        companyName: "Old Company",
      }),
      tokenCacheEnc: encryptJson({
        accessToken: "stale-access-token",
        refreshToken: "refresh-token-123",
        tokenType: "bearer",
        expiresAt: "2026-04-24T05:00:00.000Z",
      }),
    });

    const exchangeRefreshToken = vi.fn().mockResolvedValue({
      accessToken: "access-token-456",
      refreshToken: "refresh-token-789",
      tokenType: "bearer",
      expiresAt: new Date("2026-04-24T07:00:00.000Z"),
    });

    const probeQuickBooksAccounting = vi.fn().mockResolvedValue({
      companyInfo: { CompanyName: "Acme Services LLC", Country: "US" },
    });
    const listQuickBooksCustomers = vi.fn().mockResolvedValue([
      { Id: "42", DisplayName: "Acme Managed IT" },
      { Id: "84", DisplayName: "Northwind Services" },
    ]);
    const listQuickBooksInvoices = vi.fn().mockResolvedValue([
      { Id: "9001", DocNumber: "INV-9001", TotalAmt: 1250, Balance: 1250 },
      { Id: "9002", DocNumber: "INV-9002", TotalAmt: 320, Balance: 0 },
    ]);
    const getQuickBooksInvoice = vi.fn().mockResolvedValue({
      Id: "9001",
      DocNumber: "INV-9001",
      TotalAmt: 1250,
      Balance: 1250,
      CustomerRef: { value: "42", name: "Acme Managed IT" },
      PrivateNote: "Monthly managed services retainer.",
    });

    const result = await loadQuickBooksPreview({
      exchangeRefreshToken,
      probeQuickBooksAccounting,
      listQuickBooksCustomers,
      listQuickBooksInvoices,
      getQuickBooksInvoice,
    });

    expect(result).toEqual({
      state: "available",
      preview: {
        companyInfo: { CompanyName: "Acme Services LLC", Country: "US" },
        recentCustomers: [
          { Id: "42", DisplayName: "Acme Managed IT" },
          { Id: "84", DisplayName: "Northwind Services" },
        ],
        recentInvoices: [
          { Id: "9001", DocNumber: "INV-9001", TotalAmt: 1250, Balance: 1250 },
          { Id: "9002", DocNumber: "INV-9002", TotalAmt: 320, Balance: 0 },
        ],
        featuredInvoice: {
          Id: "9001",
          DocNumber: "INV-9001",
          TotalAmt: 1250,
          Balance: 1250,
          CustomerRef: { value: "42", name: "Acme Managed IT" },
          PrivateNote: "Monthly managed services retainer.",
        },
        loadedAt: "2026-04-24T06:00:00.000Z",
      },
    });

    expect(exchangeRefreshToken).toHaveBeenCalledWith({
      clientId: "client-id",
      clientSecret: "client-secret",
      refreshToken: "refresh-token-123",
    });
    expect(probeQuickBooksAccounting).toHaveBeenCalledWith({
      environment: "sandbox",
      realmId: "9130355377388383",
      accessToken: "access-token-456",
    });
    expect(listQuickBooksCustomers).toHaveBeenCalledWith({
      environment: "sandbox",
      realmId: "9130355377388383",
      accessToken: "access-token-456",
      limit: 5,
    });
    expect(listQuickBooksInvoices).toHaveBeenCalledWith({
      environment: "sandbox",
      realmId: "9130355377388383",
      accessToken: "access-token-456",
      limit: 5,
    });
    expect(getQuickBooksInvoice).toHaveBeenCalledWith({
      environment: "sandbox",
      realmId: "9130355377388383",
      accessToken: "access-token-456",
      invoiceId: "9001",
    });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const updateCall = mockUpdate.mock.calls[0][0];
    expect(updateCall.where.integrationId).toBe("quickbooks-online-accounting");
    expect(updateCall.data.status).toBe("connected");
    expect(updateCall.data.lastErrorMsg).toBeNull();
    expect(updateCall.data.lastTestedAt).toEqual(now);

    vi.useRealTimers();
  });

  it("returns unavailable when no QuickBooks credential exists", async () => {
    mockFindUnique.mockResolvedValue(null);

    const result = await loadQuickBooksPreview();

    expect(result).toEqual({ state: "unavailable" });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns an error state and persists lastError when refresh fails", async () => {
    const now = new Date("2026-04-24T06:15:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    mockFindUnique.mockResolvedValue({
      integrationId: "quickbooks-online-accounting",
      provider: "quickbooks",
      status: "connected",
      fieldsEnc: encryptJson({
        clientId: "client-id",
        clientSecret: "client-secret",
        refreshToken: "refresh-token-123",
        realmId: "9130355377388383",
        environment: "sandbox",
      }),
      tokenCacheEnc: null,
    });

    const result = await loadQuickBooksPreview({
      exchangeRefreshToken: vi.fn().mockRejectedValue(new Error("invalid QuickBooks credentials")),
      probeQuickBooksAccounting: vi.fn(),
      listQuickBooksCustomers: vi.fn(),
      listQuickBooksInvoices: vi.fn(),
      getQuickBooksInvoice: vi.fn(),
    });

    expect(result).toEqual({
      state: "error",
      error: "invalid QuickBooks credentials",
    });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const updateCall = mockUpdate.mock.calls[0][0];
    expect(updateCall.data.status).toBe("error");
    expect(updateCall.data.lastErrorMsg).toBe("invalid QuickBooks credentials");
    expect(updateCall.data.lastErrorAt).toEqual(now);

    vi.useRealTimers();
  });
});
