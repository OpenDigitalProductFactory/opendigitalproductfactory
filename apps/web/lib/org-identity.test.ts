import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    organization: { findFirst: vi.fn() },
    bankAccount: { findFirst: vi.fn() },
  },
}));

vi.mock("@dpf/db", () => ({ prisma: mockPrisma }));

import { getOrgIdentity } from "./org-identity";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getOrgIdentity", () => {
  it("returns null when no Organization exists", async () => {
    mockPrisma.organization.findFirst.mockResolvedValue(null);
    expect(await getOrgIdentity()).toBeNull();
    expect(mockPrisma.bankAccount.findFirst).not.toHaveBeenCalled();
  });

  it("maps org fields, prefers legalName, formats address, and resolves VAT + bank", async () => {
    mockPrisma.organization.findFirst.mockResolvedValue({
      name: "Acme Trading",
      legalName: "Acme Trading Ltd",
      email: "hello@acme.example",
      phone: "+44 20 7946 0000",
      website: "https://acme.example",
      address: { line1: "1 High St", city: "London", postalCode: "EC1A 1BB", country: "UK" },
      logoUrl: "https://acme.example/logo.png",
      taxProfile: {
        registrations: [
          { taxType: "income", registrationNumber: "INC-1", registrationStatus: "active" },
          { taxType: "VAT", registrationNumber: "GB123456789", registrationStatus: "active" },
        ],
      },
    });
    mockPrisma.bankAccount.findFirst.mockResolvedValue({
      name: "Acme Current",
      bankName: "Big Bank",
      accountNumber: "12345678",
      sortCode: "12-34-56",
      iban: "GB00BIGB12345678",
    });

    const id = await getOrgIdentity();

    expect(id?.name).toBe("Acme Trading Ltd"); // legalName preferred
    expect(id?.email).toBe("hello@acme.example");
    expect(id?.addressLines).toEqual(["1 High St", "London", "EC1A 1BB", "UK"]);
    expect(id?.vatNumber).toBe("GB123456789"); // VAT registration chosen over income
    expect(id?.bank).toEqual({
      bankName: "Big Bank",
      accountName: "Acme Current",
      accountNumber: "12345678",
      sortCode: "12-34-56",
      iban: "GB00BIGB12345678",
    });
  });

  it("falls back to name and leaves fields null when data is absent", async () => {
    mockPrisma.organization.findFirst.mockResolvedValue({
      name: "Solo Co",
      legalName: null,
      email: null,
      phone: null,
      website: null,
      address: null,
      logoUrl: null,
      taxProfile: null,
    });
    mockPrisma.bankAccount.findFirst.mockResolvedValue(null);

    const id = await getOrgIdentity();
    expect(id?.name).toBe("Solo Co");
    expect(id?.vatNumber).toBeNull();
    expect(id?.bank).toBeNull();
    expect(id?.addressLines).toEqual([]);
  });

  it("ignores draft registrations without a number", async () => {
    mockPrisma.organization.findFirst.mockResolvedValue({
      name: "Co", legalName: null, email: null, phone: null, website: null, address: null, logoUrl: null,
      taxProfile: { registrations: [{ taxType: "VAT", registrationNumber: null, registrationStatus: "draft" }] },
    });
    mockPrisma.bankAccount.findFirst.mockResolvedValue(null);
    const id = await getOrgIdentity();
    expect(id?.vatNumber).toBeNull();
  });
});
