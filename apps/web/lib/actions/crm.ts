"use server";

import { prisma } from "@dpf/db";
import crypto from "crypto";
import { STAGE_DEFAULT_PROBABILITY } from "@dpf/validators";
import { generateInvoiceFromSalesOrder } from "@/lib/actions/finance";

// ─── Activity Logging (used by all other actions) ───────────────────────────

export async function logActivity(input: {
  type: string;
  subject: string;
  body?: string;
  scheduledAt?: string;
  completedAt?: string;
  accountId?: string;
  contactId?: string;
  opportunityId?: string;
  createdById?: string | null;
}) {
  return prisma.activity.create({
    data: {
      activityId: `ACT-${crypto.randomUUID()}`,
      type: input.type,
      subject: input.subject,
      body: input.body || null,
      scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
      completedAt: input.completedAt ? new Date(input.completedAt) : null,
      accountId: input.accountId || null,
      contactId: input.contactId || null,
      opportunityId: input.opportunityId || null,
      createdById: input.createdById || null,
    },
  });
}

/** Auto-log a system event (no user attribution) */
async function logSystemActivity(
  subject: string,
  opts: {
    type?: string;
    body?: string;
    accountId?: string;
    contactId?: string;
    opportunityId?: string;
  } = {},
) {
  return logActivity({
    type: opts.type || "system",
    subject,
    body: opts.body,
    accountId: opts.accountId,
    contactId: opts.contactId,
    opportunityId: opts.opportunityId,
    createdById: null,
  });
}

// ─── Engagement Actions ─────────────────────────────────────────────────────

export async function createEngagement(input: {
  title: string;
  contactId: string;
  accountId?: string;
  source?: string;
  sourceRefId?: string;
  assignedToId?: string;
  notes?: string;
  userId?: string;
}) {
  const engagement = await prisma.engagement.create({
    data: {
      engagementId: `ENG-${crypto.randomUUID()}`,
      title: input.title.trim(),
      status: "new",
      contactId: input.contactId,
      accountId: input.accountId || null,
      source: input.source || null,
      sourceRefId: input.sourceRefId || null,
      assignedToId: input.assignedToId || null,
      notes: input.notes?.trim() || null,
    },
    include: {
      contact: true,
      account: true,
      assignedTo: { select: { id: true, email: true } },
    },
  });

  // Auto-log
  await logSystemActivity(
    `Engagement "${engagement.title}" created`,
    {
      type: "status_change",
      accountId: engagement.accountId || undefined,
      contactId: engagement.contactId,
    },
  );

  return engagement;
}

export async function qualifyEngagement(
  engagementId: string,
  opts: {
    opportunityTitle?: string;
    expectedValue?: number;
    expectedClose?: string;
    userId?: string;
  } = {},
) {
  const engagement = await prisma.engagement.findUnique({
    where: { id: engagementId },
    include: { contact: true, account: true },
  });
  if (!engagement) throw new Error("Engagement not found");
  if (engagement.status === "converted")
    throw new Error("Engagement already converted");

  if (!engagement.accountId) {
    throw new Error(
      "Engagement must be linked to an account before qualification",
    );
  }

  // Create opportunity and update engagement in a transaction
  const result = await prisma.$transaction(async (tx) => {
    const opportunity = await tx.opportunity.create({
      data: {
        opportunityId: `OPP-${crypto.randomUUID()}`,
        title:
          opts.opportunityTitle?.trim() ||
          engagement.title,
        stage: "qualification",
        probability: 10,
        accountId: engagement.accountId!,
        contactId: engagement.contactId,
        assignedToId: engagement.assignedToId,
        engagementId: engagement.id,
        expectedValue: opts.expectedValue ?? null,
        expectedClose: opts.expectedClose
          ? new Date(opts.expectedClose)
          : null,
      },
      include: {
        account: true,
        contact: true,
        assignedTo: { select: { id: true, email: true } },
        activities: true,
      },
    });

    await tx.engagement.update({
      where: { id: engagementId },
      data: {
        status: "converted",
        convertedToId: opportunity.id,
      },
    });

    return opportunity;
  });

  // Auto-log
  await logSystemActivity(
    `Engagement qualified → Opportunity "${result.title}" created`,
    {
      type: "status_change",
      accountId: result.accountId,
      contactId: result.contactId || undefined,
      opportunityId: result.id,
    },
  );

  return result;
}

// ─── Opportunity Actions ────────────────────────────────────────────────────

export async function createOpportunity(input: {
  title: string;
  accountId: string;
  contactId?: string;
  stage?: string;
  probability?: number;
  expectedValue?: number;
  currency?: string;
  expectedClose?: string;
  assignedToId?: string;
  engagementId?: string;
  notes?: string;
  userId?: string;
}) {
  const stage = input.stage || "qualification";
  const probability =
    input.probability ?? STAGE_DEFAULT_PROBABILITY[stage] ?? 10;

  const opportunity = await prisma.opportunity.create({
    data: {
      opportunityId: `OPP-${crypto.randomUUID()}`,
      title: input.title.trim(),
      stage,
      probability,
      accountId: input.accountId,
      contactId: input.contactId || null,
      assignedToId: input.assignedToId || null,
      engagementId: input.engagementId || null,
      expectedValue: input.expectedValue ?? null,
      currency: input.currency || "USD",
      expectedClose: input.expectedClose
        ? new Date(input.expectedClose)
        : null,
      notes: input.notes?.trim() || null,
    },
    include: {
      account: true,
      contact: true,
      assignedTo: { select: { id: true, email: true } },
      activities: true,
    },
  });

  await logSystemActivity(
    `Opportunity "${opportunity.title}" created in ${stage}`,
    {
      type: "status_change",
      accountId: opportunity.accountId,
      contactId: opportunity.contactId || undefined,
      opportunityId: opportunity.id,
    },
  );

  return opportunity;
}

export async function advanceOpportunityStage(
  opportunityId: string,
  newStage: string,
  opts: { probability?: number; userId?: string } = {},
) {
  const opp = await prisma.opportunity.findUnique({
    where: { id: opportunityId },
  });
  if (!opp) throw new Error("Opportunity not found");

  const oldStage = opp.stage;
  if (oldStage === newStage) return opp;

  const probability =
    opts.probability ?? STAGE_DEFAULT_PROBABILITY[newStage] ?? opp.probability;

  const updated = await prisma.opportunity.update({
    where: { id: opportunityId },
    data: {
      stage: newStage,
      probability,
      stageChangedAt: new Date(),
      isDormant: false, // Reset dormant on stage change
      ...(newStage === "closed_won" && { actualClose: new Date() }),
      ...(newStage === "closed_lost" && { actualClose: new Date() }),
    },
    include: {
      account: true,
      contact: true,
      assignedTo: { select: { id: true, email: true } },
      activities: true,
    },
  });

  await logSystemActivity(
    `Opportunity stage: ${oldStage} → ${newStage} (${probability}%)`,
    {
      type: "status_change",
      accountId: updated.accountId,
      contactId: updated.contactId || undefined,
      opportunityId: updated.id,
    },
  );

  return updated;
}

export async function closeOpportunity(
  opportunityId: string,
  won: boolean,
  opts: { lostReason?: string; userId?: string } = {},
) {
  const stage = won ? "closed_won" : "closed_lost";
  const opp = await prisma.opportunity.update({
    where: { id: opportunityId },
    data: {
      stage,
      probability: won ? 100 : 0,
      actualClose: new Date(),
      stageChangedAt: new Date(),
      isDormant: false,
      lostReason: won ? null : (opts.lostReason?.trim() || null),
    },
    include: {
      account: true,
      contact: true,
      assignedTo: { select: { id: true, email: true } },
      activities: true,
    },
  });

  await logSystemActivity(
    won
      ? `Opportunity closed WON`
      : `Opportunity closed LOST${opts.lostReason ? `: ${opts.lostReason}` : ""}`,
    {
      type: "status_change",
      accountId: opp.accountId,
      contactId: opp.contactId || undefined,
      opportunityId: opp.id,
    },
  );

  return opp;
}

// ─── Dormant Deal Detection ─────────────────────────────────────────────────

const DORMANT_THRESHOLD_DAYS = 45;

export async function flagDormantOpportunities() {
  const threshold = new Date();
  threshold.setDate(threshold.getDate() - DORMANT_THRESHOLD_DAYS);

  const stale = await prisma.opportunity.findMany({
    where: {
      isDormant: false,
      stage: { notIn: ["closed_won", "closed_lost"] },
      stageChangedAt: { lt: threshold },
    },
    select: { id: true, accountId: true, contactId: true, title: true },
  });

  for (const opp of stale) {
    await prisma.opportunity.update({
      where: { id: opp.id },
      data: { isDormant: true },
    });

    await logSystemActivity(
      `Opportunity "${opp.title}" marked dormant (no stage change in ${DORMANT_THRESHOLD_DAYS} days)`,
      {
        type: "system",
        accountId: opp.accountId,
        contactId: opp.contactId || undefined,
        opportunityId: opp.id,
      },
    );
  }

  return { flagged: stale.length };
}

// ─── Quote Actions ──────────────────────────────────────────────────────────

/** Generate sequential quote number: QUO-YYYY-NNNN */
async function nextQuoteNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const result = await prisma.$queryRawUnsafe<{ nextval: bigint }[]>(
    `SELECT nextval('quote_number_seq')`,
  );
  const seq = Number(result[0]!.nextval);
  return `QUO-${year}-${String(seq).padStart(4, "0")}`;
}

/** Generate sequential sales order ref: SO-YYYY-NNNN */
async function nextSalesOrderRef(): Promise<string> {
  const year = new Date().getFullYear();
  const result = await prisma.$queryRawUnsafe<{ nextval: bigint }[]>(
    `SELECT nextval('sales_order_number_seq')`,
  );
  const seq = Number(result[0]!.nextval);
  return `SO-${year}-${String(seq).padStart(4, "0")}`;
}

/** Calculate line total: unitPrice * quantity * (1 - discountPercent/100) */
function calcLineTotal(
  unitPrice: number,
  quantity: number,
  discountPercent: number,
): number {
  return unitPrice * quantity * (1 - discountPercent / 100);
}

export async function createQuote(input: {
  opportunityId: string;
  validUntil: string;
  lineItems: {
    productId?: string;
    description: string;
    quantity: number;
    unitPrice: number;
    discountPercent?: number;
    taxPercent?: number;
    sortOrder?: number;
  }[];
  discountType?: string;
  discountValue?: number;
  currency?: string;
  terms?: string;
  notes?: string;
  userId?: string;
}) {
  const opp = await prisma.opportunity.findUnique({
    where: { id: input.opportunityId },
    select: { id: true, accountId: true },
  });
  if (!opp) throw new Error("Opportunity not found");

  const quoteNumber = await nextQuoteNumber();
  const discountType = input.discountType || "percentage";
  const discountValue = input.discountValue ?? 0;

  // Calculate totals
  const lines = input.lineItems.map((li, i) => {
    const dp = li.discountPercent ?? 0;
    const tp = li.taxPercent ?? 0;
    const lineTotal = calcLineTotal(li.unitPrice, li.quantity, dp);
    return { ...li, discountPercent: dp, taxPercent: tp, lineTotal, sortOrder: li.sortOrder ?? i };
  });

  const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);

  const headerDiscount =
    discountType === "percentage"
      ? subtotal * (discountValue / 100)
      : discountValue;

  const taxAmount = lines.reduce(
    (sum, l) => sum + l.lineTotal * (l.taxPercent / 100),
    0,
  );

  const totalAmount = subtotal - headerDiscount + taxAmount;

  const quote = await prisma.$transaction(async (tx) => {
    const created = await tx.quote.create({
      data: {
        quoteId: `QUO-${crypto.randomUUID()}`,
        quoteNumber,
        version: 1,
        status: "draft",
        opportunityId: input.opportunityId,
        accountId: opp.accountId,
        validFrom: new Date(),
        validUntil: new Date(input.validUntil),
        subtotal,
        discountType,
        discountValue,
        taxAmount,
        totalAmount,
        currency: input.currency || "USD",
        terms: input.terms?.trim() || null,
        notes: input.notes?.trim() || null,
        createdById: input.userId || null,
        lineItems: {
          create: lines.map((l) => ({
            productId: l.productId || null,
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            discountPercent: l.discountPercent,
            taxPercent: l.taxPercent,
            lineTotal: l.lineTotal,
            sortOrder: l.sortOrder,
          })),
        },
      },
      include: {
        lineItems: { orderBy: { sortOrder: "asc" } },
        opportunity: { select: { id: true, opportunityId: true, title: true } },
        account: { select: { id: true, accountId: true, name: true } },
      },
    });
    return created;
  });

  await logSystemActivity(`Quote ${quoteNumber} created (${quote.currency} ${totalAmount.toFixed(2)})`, {
    type: "quote_event",
    accountId: quote.accountId,
    opportunityId: quote.opportunityId,
  });

  return quote;
}

export async function reviseQuote(quoteId: string, userId?: string) {
  const current = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: { lineItems: { orderBy: { sortOrder: "asc" } } },
  });
  if (!current) throw new Error("Quote not found");
  if (current.status === "accepted") throw new Error("Cannot revise an accepted quote");

  const quoteNumber = await nextQuoteNumber();

  const revised = await prisma.$transaction(async (tx) => {
    // Supersede current
    await tx.quote.update({
      where: { id: quoteId },
      data: { status: "superseded" },
    });

    // Create new version
    const newQuote = await tx.quote.create({
      data: {
        quoteId: `QUO-${crypto.randomUUID()}`,
        quoteNumber,
        version: current.version + 1,
        previousId: current.id,
        status: "draft",
        opportunityId: current.opportunityId,
        accountId: current.accountId,
        validFrom: new Date(),
        validUntil: current.validUntil,
        subtotal: current.subtotal,
        discountType: current.discountType,
        discountValue: current.discountValue,
        taxAmount: current.taxAmount,
        totalAmount: current.totalAmount,
        currency: current.currency,
        terms: current.terms,
        notes: current.notes,
        createdById: userId || null,
        lineItems: {
          create: current.lineItems.map((li) => ({
            productId: li.productId,
            description: li.description,
            quantity: li.quantity,
            unitPrice: li.unitPrice,
            discountPercent: li.discountPercent,
            taxPercent: li.taxPercent,
            lineTotal: li.lineTotal,
            sortOrder: li.sortOrder,
          })),
        },
      },
      include: {
        lineItems: { orderBy: { sortOrder: "asc" } },
        opportunity: { select: { id: true, opportunityId: true, title: true } },
        account: { select: { id: true, accountId: true, name: true } },
      },
    });
    return newQuote;
  });

  await logSystemActivity(`Quote revised: ${current.quoteNumber} → ${revised.quoteNumber} (v${revised.version})`, {
    type: "quote_event",
    accountId: revised.accountId,
    opportunityId: revised.opportunityId,
  });

  return revised;
}

export async function sendQuote(quoteId: string, userId?: string) {
  const quote = await prisma.quote.update({
    where: { id: quoteId },
    data: { status: "sent", sentAt: new Date() },
    include: {
      lineItems: { orderBy: { sortOrder: "asc" } },
      account: { select: { id: true, accountId: true, name: true } },
    },
  });

  await logSystemActivity(`Quote ${quote.quoteNumber} sent to ${quote.account.name}`, {
    type: "quote_event",
    accountId: quote.accountId,
    opportunityId: quote.opportunityId,
  });

  return quote;
}

export async function acceptQuote(quoteId: string, userId?: string) {
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: { opportunity: true },
  });
  if (!quote) throw new Error("Quote not found");
  if (quote.status === "accepted") throw new Error("Quote already accepted");

  const orderRef = await nextSalesOrderRef();

  const result = await prisma.$transaction(async (tx) => {
    // Accept quote
    const accepted = await tx.quote.update({
      where: { id: quoteId },
      data: { status: "accepted", acceptedAt: new Date() },
      include: {
        lineItems: { orderBy: { sortOrder: "asc" } },
        account: { select: { id: true, accountId: true, name: true } },
      },
    });

    // Create sales order
    const order = await tx.salesOrder.create({
      data: {
        orderRef,
        status: "confirmed",
        quoteId: accepted.id,
        accountId: accepted.accountId,
        totalAmount: accepted.totalAmount,
        currency: accepted.currency,
      },
    });

    // Close opportunity as won
    await tx.opportunity.update({
      where: { id: accepted.opportunityId },
      data: {
        stage: "closed_won",
        probability: 100,
        actualClose: new Date(),
        stageChangedAt: new Date(),
        isDormant: false,
      },
    });

    return { quote: accepted, salesOrder: order };
  });

  await logSystemActivity(
    `Quote ${result.quote.quoteNumber} accepted → Sales Order ${result.salesOrder.orderRef} created`,
    {
      type: "quote_event",
      accountId: result.quote.accountId,
      opportunityId: result.quote.opportunityId,
    },
  );

  await logSystemActivity("Opportunity closed WON (quote accepted)", {
    type: "status_change",
    accountId: result.quote.accountId,
    opportunityId: result.quote.opportunityId,
  });

  // Auto-generate invoice from sales order
  try {
    await generateInvoiceFromSalesOrder(result.salesOrder.id);
  } catch (err) {
    console.error("Auto-invoice generation failed for SalesOrder", result.salesOrder.orderRef, err);
  }

  return result;
}

export async function rejectQuote(
  quoteId: string,
  opts: { reason?: string; userId?: string } = {},
) {
  const quote = await prisma.quote.update({
    where: { id: quoteId },
    data: { status: "rejected", rejectedAt: new Date() },
    include: {
      account: { select: { id: true, accountId: true, name: true } },
    },
  });

  await logSystemActivity(
    `Quote ${quote.quoteNumber} rejected${opts.reason ? `: ${opts.reason}` : ""}`,
    {
      type: "quote_event",
      accountId: quote.accountId,
      opportunityId: quote.opportunityId,
    },
  );

  return quote;
}
