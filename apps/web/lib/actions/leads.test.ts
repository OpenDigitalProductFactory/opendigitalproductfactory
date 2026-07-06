import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { checkMock } = vi.hoisted(() => ({ checkMock: vi.fn() }));
vi.mock("@/lib/mdm/dedup-gate", () => ({ checkCustomerAccountDuplicates: checkMock }));

vi.mock("@dpf/db", () => ({
  prisma: {
    customerAccount: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    customerContact: { findUnique: vi.fn(), create: vi.fn() },
    engagement: { create: vi.fn(), update: vi.fn() },
  },
}));

import { prisma } from "@dpf/db";
import { createLead, updateEngagementStatus } from "./leads";

const p = prisma as unknown as {
  customerAccount: { findFirst: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  customerContact: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  engagement: { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  checkMock.mockResolvedValue({ verdict: "clear", candidates: [] });
  p.customerAccount.findFirst.mockResolvedValue(null);
  p.customerContact.findUnique.mockResolvedValue(null);
  p.customerContact.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: "c1", ...data }));
  p.customerAccount.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: "a1", name: data.name }));
  p.engagement.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: "e1", ...data }));
});

describe("createLead", () => {
  it("lands the trio: prospect account, email-identity contact, new engagement", async () => {
    const res = await createLead({ firstName: "Dan", lastName: "Warfield", email: "Dan@ManagingDigital.com", company: "Managing Digital" });
    expect(p.customerAccount.create.mock.calls[0][0].data.status).toBe("prospect");
    const contact = p.customerContact.create.mock.calls[0][0].data;
    expect(contact.email).toBe("dan@managingdigital.com");
    expect(contact.accountId).toBe("a1");
    const eng = p.engagement.create.mock.calls[0][0].data;
    expect(eng.status).toBe("new");
    expect(eng.source).toBe("manual");
    expect(eng.title).toContain("Dan Warfield");
    expect(res.engagementId).toBe("e1");
  });

  it("reuses an exact-name account instead of creating a duplicate", async () => {
    p.customerAccount.findFirst.mockResolvedValue({ id: "a-existing", name: "Managing Digital" });
    await createLead({ firstName: "Dan", email: "dan@md.com", company: "managing digital" });
    expect(p.customerAccount.create).not.toHaveBeenCalled();
    expect(p.engagement.create.mock.calls[0][0].data.accountId).toBe("a-existing");
  });

  it("reuses a likely-duplicate account flagged by the dedup gate", async () => {
    checkMock.mockResolvedValue({ verdict: "likely-duplicate", candidates: [{ id: "a-dup" }] });
    p.customerAccount.findUnique.mockResolvedValue({ id: "a-dup", name: "Managing Digital Ltd" });
    await createLead({ firstName: "Dan", email: "dan@md.com", company: "Managing Digital" });
    expect(p.customerAccount.create).not.toHaveBeenCalled();
    expect(p.engagement.create.mock.calls[0][0].data.accountId).toBe("a-dup");
  });

  it("reuses an existing contact by email identity", async () => {
    p.customerContact.findUnique.mockResolvedValue({ id: "c-existing", email: "dan@md.com" });
    await createLead({ firstName: "Dan", email: "dan@md.com", company: "MD" });
    expect(p.customerContact.create).not.toHaveBeenCalled();
    expect(p.engagement.create.mock.calls[0][0].data.contactId).toBe("c-existing");
  });

  it("requires first name, email, and company", async () => {
    await expect(createLead({ firstName: "", email: "x@y.com", company: "C" })).rejects.toThrow(/required/i);
  });
});

describe("updateEngagementStatus", () => {
  it("applies the triage transition", async () => {
    p.engagement.update.mockResolvedValue({ id: "e1", accountId: "a1" });
    await updateEngagementStatus("e1", "contacted");
    expect(p.engagement.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "e1" }, data: { status: "contacted" } }),
    );
  });
});
