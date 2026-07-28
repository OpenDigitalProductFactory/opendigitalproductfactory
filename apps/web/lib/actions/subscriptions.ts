"use server";

import crypto from "crypto";
import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";
import {
  appendProductSoldEvidence,
  createProductSoldEntitlement,
  createProductSoldPartyLinks,
  createTypedFulfillmentInstance,
  persistProductFulfillmentInstance,
  persistProductSoldEntitlement,
  persistProductSoldPartyLinks,
} from "@/lib/products/product-sold";

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

async function attachSupportSubscriptionTrace(input: {
  salesOrderId: string;
  orderRef: string;
  account: { id: string; accountId?: string; name: string };
  subscription: {
    id: string;
    subscriptionRef?: string;
    planName?: string;
    billingCadence?: string;
    startDate?: Date;
    renewalDate?: Date;
    autoRenew?: boolean;
  };
  edgeNodeId?: string;
}) {
  const saleEvidence = await prisma.productSoldEvidence.findMany({
    where: { salesOrderId: input.salesOrderId },
    select: {
      productSold: {
        select: { id: true, organizationId: true },
      },
    },
  });
  if (saleEvidence.length === 0) return;

  const observedAt = input.subscription.startDate ?? new Date();
  for (const { productSold } of saleEvidence) {
    const evidence = await appendProductSoldEvidence({
      db: prisma,
      organizationId: productSold.organizationId,
      productSoldId: productSold.id,
      kind: "support-subscription",
      sourceId: input.subscription.id,
      sourceRef: input.subscription.subscriptionRef ?? input.subscription.id,
      observedAt,
      snapshot: {
        subscriptionRef:
          input.subscription.subscriptionRef ?? input.subscription.id,
        salesOrderId: input.salesOrderId,
        orderRef: input.orderRef,
        planName: input.subscription.planName ?? null,
        billingCadence: input.subscription.billingCadence ?? null,
        autoRenew: input.subscription.autoRenew ?? null,
        renewalDate: input.subscription.renewalDate?.toISOString() ?? null,
      },
    });
    const partyLinks = createProductSoldPartyLinks({
      evidenceId: evidence.id,
      observedAt,
      account: {
        id: input.account.id,
        accountId: input.account.accountId ?? input.account.id,
        name: input.account.name,
      },
      contact: null,
      subscriber: {
        kind: "account",
        account: {
          id: input.account.id,
          accountId: input.account.accountId ?? input.account.id,
          name: input.account.name,
        },
      },
      evidenceSnapshot: {},
    });
    await persistProductSoldPartyLinks({
      db: prisma,
      organizationId: productSold.organizationId,
      productSoldId: productSold.id,
      links: partyLinks.filter((link) => link.role === "subscriber"),
    });
    await persistProductSoldEntitlement({
      db: prisma,
      organizationId: productSold.organizationId,
      productSoldId: productSold.id,
      entitlement: createProductSoldEntitlement({
        evidenceId: evidence.id,
        entitlement: {
          kind: "support-contract",
          accountId: input.account.id,
          contactId: null,
          subscriptionId: input.subscription.id,
          quantity: 1,
          rights: {
            planName: input.subscription.planName ?? null,
            billingCadence: input.subscription.billingCadence ?? null,
            autoRenew: input.subscription.autoRenew ?? null,
          },
          validFrom: observedAt,
          validTo: input.subscription.renewalDate ?? null,
        },
      }),
    });
    if (input.edgeNodeId) {
      await persistProductFulfillmentInstance({
        db: prisma,
        organizationId: productSold.organizationId,
        productSoldId: productSold.id,
        instance: createTypedFulfillmentInstance({
          evidenceId: evidence.id,
          kind: "supported-instance",
          status: "active",
          targets: {
            storefrontBookingId: null,
            rentalAgreementId: null,
            rentableUnitId: null,
            edgeNodeId: input.edgeNodeId,
          },
          snapshot: {
            edgeNodeId: input.edgeNodeId,
            subscriptionRef:
              input.subscription.subscriptionRef ?? input.subscription.id,
          },
        }),
      });
    }
  }
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
    include: {
      account: { select: { id: true, accountId: true, name: true } },
      subscription: true,
    },
  });
  if (!order) throw new Error("Sales order not found");
  if (order.subscription) {
    await attachSupportSubscriptionTrace({
      salesOrderId: order.id,
      orderRef: order.orderRef,
      account: order.account,
      subscription: order.subscription,
      edgeNodeId: opts.edgeNodeId,
    });
    return order.subscription;
  }

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

  await attachSupportSubscriptionTrace({
    salesOrderId: order.id,
    orderRef: order.orderRef,
    account: order.account,
    subscription,
    edgeNodeId: opts.edgeNodeId,
  });

  // Auto-renewing contracts get a paired RecurringSchedule so the existing
  // daily recurring-invoice cron (generateDueInvoices) mints each renewal
  // invoice when renewalDate arrives and keeps the contract's renewalDate
  // advancing. The order already billed the first period, so the schedule
  // starts AT the renewal date, not today. Non-auto-renew contracts get no
  // schedule — the renewal sweep expires them when their term ends.
  if (subscription.autoRenew) {
    const frequency = cadence === "annual" ? "annually" : cadence; // schedule vocab
    await prisma.recurringSchedule.create({
      data: {
        scheduleId: `REC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        accountId: order.accountId,
        subscriptionId: subscription.id,
        name: `${subscription.planName} — renewal`,
        frequency,
        amount: order.totalAmount,
        currency: order.currency,
        startDate: renewal,
        nextInvoiceDate: renewal,
        status: "active",
        autoSend: true,
        lineItems: {
          create: [
            {
              description: subscription.planName,
              quantity: 1,
              unitPrice: order.totalAmount,
              taxRate: 0,
              sortOrder: 0,
            },
          ],
        },
      },
    });
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
