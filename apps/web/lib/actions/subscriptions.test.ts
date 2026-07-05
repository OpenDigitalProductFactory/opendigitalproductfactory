import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@dpf/db", () => ({
  prisma: {
    customerAccount: { findUnique: vi.fn(), update: vi.fn() },
    salesOrder: { findUnique: vi.fn() },
    subscription: { create: vi.fn() },
    edgeNode: { update: vi.fn() },
    activity: { create: vi.fn().mockResolvedValue({}) },
  },
}));

import { prisma } from "@dpf/db";
import { convertAccountToActiveCustomer, convertOrderToSubscription } from "./subscriptions";

const p = prisma as unknown as {
  customerAccount: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  salesOrder: { findUnique: ReturnType<typeof vi.fn> };
  subscription: { create: ReturnType<typeof vi.fn> };
  edgeNode: { update: ReturnType<typeof vi.fn> };
};

beforeEach(() => vi.clearAllMocks());

describe("convertAccountToActiveCustomer", () => {
  it("flips a prospect to active", async () => {
    p.customerAccount.findUnique.mockResolvedValue({ id: "a1", name: "Emma3D", status: "prospect" });
    p.customerAccount.update.mockResolvedValue({ id: "a1", status: "active" });
    const out = await convertAccountToActiveCustomer("a1");
    expect(p.customerAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "a1" }, data: { status: "active" } }),
    );
    expect(out.status).toBe("active");
  });

  it("is idempotent on an already-active account (no update)", async () => {
    p.customerAccount.findUnique.mockResolvedValue({ id: "a1", name: "Emma3D", status: "active" });
    await convertAccountToActiveCustomer("a1");
    expect(p.customerAccount.update).not.toHaveBeenCalled();
  });

  it("throws on a missing account", async () => {
    p.customerAccount.findUnique.mockResolvedValue(null);
    await expect(convertAccountToActiveCustomer("nope")).rejects.toThrow(/not found/i);
  });
});

describe("convertOrderToSubscription", () => {
  const order = {
    id: "so1",
    accountId: "a1",
    totalAmount: 12000,
    currency: "GBP",
    account: { id: "a1", name: "Emma3D" },
    subscription: null,
  };

  it("creates an active annual contract carrying the order's value and account", async () => {
    p.salesOrder.findUnique.mockResolvedValue(order);
    p.subscription.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: "sub1", ...data }));
    const sub = await convertOrderToSubscription("so1");
    const created = p.subscription.create.mock.calls[0][0].data;
    expect(created.status).toBe("active");
    expect(created.accountId).toBe("a1");
    expect(created.salesOrderId).toBe("so1");
    expect(created.totalValue).toBe(12000);
    expect(created.currency).toBe("GBP");
    expect(created.billingCadence).toBe("annual");
    expect(created.subscriptionRef).toMatch(/^SUB-\d{4}-[0-9A-F]{6}$/);
    expect(sub.id).toBe("sub1");
  });

  it("links an edge node (DPF instance) to the contract when provided", async () => {
    p.salesOrder.findUnique.mockResolvedValue(order);
    p.subscription.create.mockResolvedValue({ id: "sub1" });
    p.edgeNode.update.mockResolvedValue({ id: "en1", subscriptionId: "sub1" });
    await convertOrderToSubscription("so1", { edgeNodeId: "en1" });
    expect(p.edgeNode.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "en1" }, data: { subscriptionId: "sub1" } }),
    );
  });

  it("is idempotent per order — returns the existing contract, creates nothing", async () => {
    p.salesOrder.findUnique.mockResolvedValue({ ...order, subscription: { id: "existing" } });
    const sub = await convertOrderToSubscription("so1");
    expect(sub).toEqual({ id: "existing" });
    expect(p.subscription.create).not.toHaveBeenCalled();
  });
});
