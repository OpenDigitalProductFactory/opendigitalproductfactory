import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => ({
  accountCreate: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    customerContact: { findUnique: vi.fn() },
    customerAccount: { create: vi.fn() },
    $transaction: vi.fn((fn: (client: unknown) => Promise<unknown>) => fn({
      customerAccount: { create: tx.accountCreate },
      customerContact: {},
      principal: {},
      principalAlias: {},
      user: {},
    })),
  },
}));

vi.mock("@/lib/password", () => ({ hashPassword: vi.fn(async () => "hashed") }));
vi.mock("@/lib/identity/principal-linking", () => ({ syncCustomerPrincipal: vi.fn() }));

import { prisma } from "@dpf/db";
import { syncCustomerPrincipal } from "@/lib/identity/principal-linking";
import { customerSignup } from "./customer-auth";

describe("customerSignup Principal convergence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.customerContact.findUnique).mockResolvedValue(null);
    tx.accountCreate.mockResolvedValue({
      id: "account-row-1",
      accountId: "CUST-1",
      contacts: [{ id: "contact-1" }],
    });
  });

  it("commits the contact and canonical Principal in one transaction", async () => {
    await expect(customerSignup({
      email: "buyer@example.com",
      password: "correct-horse",
      companyName: "Buyer Co",
    })).resolves.toEqual({ success: true });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(syncCustomerPrincipal).toHaveBeenCalledWith("contact-1", expect.anything());
    expect(prisma.customerAccount.create).not.toHaveBeenCalled();
  });

  it("fails signup when Principal convergence fails", async () => {
    vi.mocked(syncCustomerPrincipal).mockRejectedValueOnce(new Error("alias conflict"));
    await expect(customerSignup({
      email: "buyer@example.com",
      password: "correct-horse",
      companyName: "Buyer Co",
    })).rejects.toThrow("alias conflict");
  });
});
