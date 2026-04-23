import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    customerSite: {
      create: vi.fn(),
    },
    customerSiteNode: {
      create: vi.fn(),
    },
    activity: {
      create: vi.fn(),
    },
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/actions/finance", () => ({
  generateInvoiceFromSalesOrder: vi.fn(),
}));

import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";
import { createCustomerSite, createCustomerSiteNode } from "./crm";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createCustomerSite", () => {
  it("rejects blank site names", async () => {
    await expect(
      createCustomerSite({
        accountId: "acct-1",
        name: "   ",
      }),
    ).rejects.toThrow(/site name/i);

    expect(prisma.customerSite.create).not.toHaveBeenCalled();
  });

  it("creates a site for the account and revalidates customer views", async () => {
    vi.mocked(prisma.customerSite.create).mockResolvedValue({
      id: "site-1",
      siteId: "SITE-ABC12345",
      accountId: "acct-1",
      name: "Dallas HQ",
      siteType: "office",
      status: "active",
      timezone: "America/Chicago",
      accessInstructions: "Check in at reception.",
      hoursNotes: "Managed weekdays only.",
      serviceNotes: "Primary MSP site",
    } as never);

    const site = await createCustomerSite({
      accountId: "acct-1",
      name: " Dallas HQ ",
      siteType: "office",
      status: "active",
      timezone: "America/Chicago",
      accessInstructions: "Check in at reception.",
      hoursNotes: "Managed weekdays only.",
      serviceNotes: "Primary MSP site",
    });

    expect(site.name).toBe("Dallas HQ");
    expect(prisma.customerSite.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountId: "acct-1",
        name: "Dallas HQ",
        siteType: "office",
        status: "active",
        timezone: "America/Chicago",
        accessInstructions: "Check in at reception.",
        hoursNotes: "Managed weekdays only.",
        serviceNotes: "Primary MSP site",
      }),
    });
    expect(revalidatePath).toHaveBeenCalledWith("/customer");
    expect(revalidatePath).toHaveBeenCalledWith("/customer/acct-1");
  });
});

describe("createCustomerSiteNode", () => {
  it("rejects blank node names", async () => {
    await expect(
      createCustomerSiteNode({
        accountId: "acct-1",
        siteId: "site-1",
        name: "   ",
      }),
    ).rejects.toThrow(/node name/i);

    expect(prisma.customerSiteNode.create).not.toHaveBeenCalled();
  });

  it("creates a child node under a site and revalidates the account detail page", async () => {
    vi.mocked(prisma.customerSiteNode.create).mockResolvedValue({
      id: "node-1",
      nodeId: "SITE-NODE-ABC12345",
      siteId: "site-1",
      parentNodeId: "node-parent-1",
      name: "Server Room",
      nodeType: "room",
      status: "active",
      notes: "Badge required.",
    } as never);

    const node = await createCustomerSiteNode({
      accountId: "acct-1",
      siteId: "site-1",
      parentNodeId: "node-parent-1",
      name: " Server Room ",
      nodeType: "room",
      notes: "Badge required.",
    });

    expect(node.name).toBe("Server Room");
    expect(prisma.customerSiteNode.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        siteId: "site-1",
        parentNodeId: "node-parent-1",
        name: "Server Room",
        nodeType: "room",
        notes: "Badge required.",
      }),
    });
    expect(revalidatePath).toHaveBeenCalledWith("/customer/acct-1");
  });
});
