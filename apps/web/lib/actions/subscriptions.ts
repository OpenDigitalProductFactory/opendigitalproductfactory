"use server";

import crypto from "crypto";
import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";

// Post-order lifecycle: turning a won deal into an ACTIVE CUSTOMER under a
// SUPPORT CONTRACT for their own instance of DPF. These wrap the two transitions
// the CRM had server-side gaps for — no model + no action for the subscription,
// and no explicit prospect→active conversion.

const CADENCE_MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, annual: 12 };

function nextSubscriptionRef(): string {
  const year = new Date().getFullYear();
  // Short random suffix keeps refs unique without a dedicated DB sequence; the
  // subscriptionRef unique index is the backstop.
  const suffix = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `SUB-${year}-${suffix}`;
}

/**
 * Flip a prospect account to an active customer. Idempotent: calling it on an
 * already-active account is a no-op that still returns the account. Emits an
 * activity for the timeline.
 */
export async function convertAccountToActiveCustomer(accountId: string) {
  const account = await prisma.customerAccount.findUnique({ where: { id: accountId } });
  if (!account) throw new Error("Account not found");
  if (account.status === "active") return account;

  const updated = await prisma.customerAccount.update({
    where: { id: accountId },
    data: { status: "active" },
  });

  await prisma.activity
    .create({
      data: {
        activityId: `ACT-${crypto.randomUUID()}`,
        type: "status_change",
        subject: `Account ${account.name} converted to active customer`,
        accountId,
        completedAt: new Date(),
      },
    })
    .catch(() => {});

  revalidatePath("/customer");
  revalidatePath(`/customer/${accountId}`);
  return updated;
}

/**
 * Create the support contract (Subscription) for a customer's DPF instance from
 * an accepted sales order. The order supplies the account, value and currency;
 * the plan name and billing cadence default sensibly and can be overridden.
 * Optionally links one EdgeNode (their provisioned instance) to the contract.
 * Idempotent per order: an order already tied to a subscription returns it.
 */
export async function convertOrderToSubscription(
  salesOrderId: string,
  opts: {
    planName?: string;
    billingCadence?: "monthly" | "quarterly" | "annual";
    autoRenew?: boolean;
    edgeNodeId?: string;
    notes?: string;
  } = {},
) {
  const order = await prisma.salesOrder.findUnique({
    where: { id: salesOrderId },
    include: { account: { select: { id: true, name: true } }, subscription: true },
  });
  if (!order) throw new Error("Sales order not found");
  if (order.subscription) return order.subscription;

  const cadence = opts.billingCadence ?? "annual";
  const months = CADENCE_MONTHS[cadence] ?? 12;
  const start = new Date();
  const renewal = new Date(start);
  renewal.setMonth(renewal.getMonth() + months);

  const subscription = await prisma.subscription.create({
    data: {
      subscriptionRef: nextSubscriptionRef(),
      status: "active",
      accountId: order.accountId,
      salesOrderId: order.id,
      planName: opts.planName ?? `DPF Managed Instance — Support & Hosting (${order.account.name})`,
      billingCadence: cadence,
      totalValue: order.totalAmount,
      currency: order.currency,
      startDate: start,
      renewalDate: renewal,
      autoRenew: opts.autoRenew ?? true,
      notes: opts.notes ?? null,
    },
  });

  // Link the customer's provisioned DPF instance (edge node) to the contract.
  if (opts.edgeNodeId) {
    await prisma.edgeNode
      .update({ where: { id: opts.edgeNodeId }, data: { subscriptionId: subscription.id } })
      .catch(() => {});
  }

  await prisma.activity
    .create({
      data: {
        activityId: `ACT-${crypto.randomUUID()}`,
        type: "status_change",
        subject: `Support contract ${subscription.subscriptionRef} created for ${order.account.name}`,
        accountId: order.accountId,
        completedAt: new Date(),
      },
    })
    .catch(() => {});

  revalidatePath("/customer");
  revalidatePath(`/customer/${order.accountId}`);
  return subscription;
}
