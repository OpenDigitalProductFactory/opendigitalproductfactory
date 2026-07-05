import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { checkMock } = vi.hoisted(() => ({ checkMock: vi.fn() }));
vi.mock("@/lib/mdm/dedup-gate", () => ({
  checkCustomerContactDuplicates: checkMock,
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    customerAccount: { findUnique: vi.fn() },
    customerContact: { findUnique: vi.fn(), create: vi.fn() },
  },
}));

import { prisma } from "@dpf/db";
import { createCustomerContact } from "./customer-contacts";

const p = prisma as unknown as {
  customerAccount: { findUnique: ReturnType<typeof vi.fn> };
  customerContact: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  p.customerAccount.findUnique.mockResolvedValue({ id: "a1", name: "Emma3D" });
  p.customerContact.findUnique.mockResolvedValue(null);
  checkMock.mockResolvedValue({ verdict: "clear", candidates: [] });
});

describe("createCustomerContact", () => {
  it("creates a contact with normalized identity fields", async () => {
    p.customerContact.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: "c1", ...data }));
    const result = await createCustomerContact({
      accountId: "a1",
      firstName: "Ian",
      lastName: "Pruden",
      email: "Ian@Emma3D.com",
      phone: "0123",
      jobTitle: "Founder",
    });
    expect(result.outcome).toBe("created");
    const data = p.customerContact.create.mock.calls[0][0].data;
    expect(data.email).toBe("ian@emma3d.com"); // lowercased identity key
    expect(data.name).toBe("Ian Pruden");
    expect(data.nameNormalized.length).toBeGreaterThan(0);
    expect(data.source).toBe("manual");
  });

  it("returns the existing contact on exact email match (never duplicates)", async () => {
    p.customerContact.findUnique.mockResolvedValue({ id: "existing", email: "ian@emma3d.com" });
    const result = await createCustomerContact({ accountId: "a1", firstName: "Ian", email: "ian@emma3d.com" });
    expect(result.outcome).toBe("existing");
    expect(p.customerContact.create).not.toHaveBeenCalled();
  });

  it("surfaces near-duplicates for a decision instead of silently creating", async () => {
    checkMock.mockResolvedValue({
      verdict: "possible-duplicate",
      candidates: [{ id: "c9", label: "Ian Prudden", detail: "ianp@emma3d.com" }],
    });
    const result = await createCustomerContact({ accountId: "a1", firstName: "Ian", email: "new@emma3d.com" });
    expect(result.outcome).toBe("duplicates-found");
    expect(p.customerContact.create).not.toHaveBeenCalled();
  });

  it("confirm-new bypasses the near-duplicate check and creates", async () => {
    p.customerContact.create.mockResolvedValue({ id: "c1" });
    const result = await createCustomerContact(
      { accountId: "a1", firstName: "Ian", email: "new@emma3d.com" },
      { kind: "confirm-new", reason: "different person" },
    );
    expect(result.outcome).toBe("created");
    expect(checkMock).not.toHaveBeenCalled();
  });

  it("throws on a missing account", async () => {
    p.customerAccount.findUnique.mockResolvedValue(null);
    await expect(
      createCustomerContact({ accountId: "nope", firstName: "Ian", email: "x@y.com" }),
    ).rejects.toThrow(/not found/i);
  });
});
