"use server";

import { prisma } from "@dpf/db";
import { composeDunningEmail, sendEmail } from "@/lib/email";

// ─── Default dunning sequence ─────────────────────────────────────────────────

const DEFAULT_STEPS = [
  {
    dayOffset: -3,
    subject: "Upcoming invoice reminder",
    emailTemplate: "friendly_predue",
    severity: "friendly",
    sortOrder: 0,
  },
  {
    dayOffset: 7,
    subject: "Payment reminder — invoice overdue",
    emailTemplate: "first_overdue",
    severity: "friendly",
    sortOrder: 1,
  },
  {
    dayOffset: 14,
    subject: "Second reminder — payment overdue",
    emailTemplate: "firm_reminder",
    severity: "firm",
    sortOrder: 2,
  },
  {
    dayOffset: 30,
    subject: "Final notice — immediate payment required",
    emailTemplate: "final_notice",
    severity: "final",
    sortOrder: 3,
  },
  {
    dayOffset: 45,
    subject: "Account escalation notice",
    emailTemplate: "escalation",
    severity: "escalation",
    sortOrder: 4,
  },
] as const;

// ─── seedDefaultDunningSequence ───────────────────────────────────────────────

export async function seedDefaultDunningSequence(): Promise<{ id: string }> {
  // Idempotent: return existing default if already seeded
  const existing = await prisma.dunningSequence.findFirst({
    where: { isDefault: true },
    select: { id: true },
  });
  if (existing) return existing;

  const sequence = await prisma.dunningSequence.create({
    data: {
      name: "Standard Credit Control",
      isDefault: true,
      isActive: true,
      steps: {
        create: DEFAULT_STEPS.map((step) => ({ ...step })),
      },
    },
    select: { id: true },
  });

  return sequence;
}

// ─── getDefaultDunningSequence ────────────────────────────────────────────────

export async function getDefaultDunningSequence() {
  await seedDefaultDunningSequence();

  return prisma.dunningSequence.findFirst({
    where: { isDefault: true },
    include: {
      steps: { orderBy: { sortOrder: "asc" } },
    },
  });
}

// ─── runDunning ───────────────────────────────────────────────────────────────

export async function runDunning(): Promise<{ remindersSent: number }> {
  const now = new Date();
  let remindersSent = 0;

  const sequence = await getDefaultDunningSequence();
  if (!sequence || sequence.steps.length === 0) return { remindersSent: 0 };

  // Find invoices that need dunning (not paid/void/draft)
  const invoices = await prisma.invoice.findMany({
    where: {
      status: { in: ["sent", "viewed", "partially_paid", "overdue"] },
      dueDate: { not: undefined },
    },
    include: {
      account: { select: { id: true, name: true } },
      contact: { select: { email: true, firstName: true, lastName: true } },
    },
  });

  for (const invoice of invoices) {
    const dueDate = invoice.dueDate;
    const daysPastDue = Math.floor(
      (now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24),
    );

    // Find applicable step: highest dayOffset that is <= daysPastDue
    const applicableStep = sequence.steps
      .filter((step) => step.dayOffset <= daysPastDue)
      .sort((a, b) => b.dayOffset - a.dayOffset)[0];

    if (!applicableStep) continue;

    // Check if already sent for this invoice + step combo
    const alreadySent = await prisma.dunningLog.findFirst({
      where: {
        invoiceId: invoice.id,
        stepId: applicableStep.id,
      },
    });

    if (alreadySent) continue;

    // Determine recipient email
    const recipientEmail = invoice.contact?.email ?? null;

    // Compose and send reminder email
    if (recipientEmail) {
      const payUrl = invoice.payToken
        ? `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/pay/${invoice.payToken}`
        : undefined;

      const emailParams = composeDunningEmail({
        to: recipientEmail,
        invoiceRef: invoice.invoiceRef,
        accountName: invoice.account.name,
        amountDue: Number(invoice.amountDue).toFixed(2),
        currency: invoice.currency,
        daysPastDue,
        severity: applicableStep.severity as "friendly" | "firm" | "final" | "escalation",
        payUrl,
      });

      await sendEmail(emailParams);
    }

    // Log the dunning action
    await prisma.dunningLog.create({
      data: {
        invoiceId: invoice.id,
        stepId: applicableStep.id,
        action: applicableStep.emailTemplate,
        emailTo: recipientEmail ?? undefined,
        notes: `Day ${daysPastDue}: applied step "${applicableStep.subject}"`,
      },
    });

    remindersSent++;

    // Update invoice reminder count and timestamp
    const updateData: Record<string, unknown> = {
      reminderCount: { increment: 1 },
      lastReminderAt: now,
    };

    // Mark as overdue if past due and not yet overdue
    if (daysPastDue > 0 && (invoice.status === "sent" || invoice.status === "viewed")) {
      updateData.status = "overdue";
    }

    await prisma.invoice.update({
      where: { id: invoice.id },
      data: updateData,
    });
  }

  return { remindersSent };
}

// ─── Aging bucket helpers ─────────────────────────────────────────────────────

type AgingBucket = {
  accountId: string;
  accountName: string;
  current: number;
  days30: number;
  days60: number;
  days90: number;
  days90plus: number;
  total: number;
};

function classifyDaysOverdue(
  dueDate: Date,
  now: Date,
): "current" | "days30" | "days60" | "days90" | "days90plus" {
  const days = Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return "current";
  if (days <= 30) return "days30";
  if (days <= 60) return "days60";
  if (days <= 90) return "days90";
  return "days90plus";
}

// ─── getAgedDebtors ───────────────────────────────────────────────────────────

export async function getAgedDebtors(): Promise<{
  rows: AgingBucket[];
  grandTotals: Omit<AgingBucket, "accountId" | "accountName">;
}> {
  const now = new Date();

  const unpaidInvoices = await prisma.invoice.findMany({
    where: {
      status: { notIn: ["paid", "void", "written_off", "draft"] },
    },
    include: {
      account: { select: { id: true, name: true } },
    },
  });

  const bucketMap = new Map<string, AgingBucket>();

  for (const invoice of unpaidInvoices) {
    const accountId = invoice.accountId;
    if (!bucketMap.has(accountId)) {
      bucketMap.set(accountId, {
        accountId,
        accountName: invoice.account.name,
        current: 0,
        days30: 0,
        days60: 0,
        days90: 0,
        days90plus: 0,
        total: 0,
      });
    }

    const bucket = bucketMap.get(accountId)!;
    const amount = Number(invoice.amountDue);
    const key = classifyDaysOverdue(invoice.dueDate, now);
    bucket[key] = Math.round((bucket[key] + amount) * 100) / 100;
    bucket.total = Math.round((bucket.total + amount) * 100) / 100;
  }

  const rows = Array.from(bucketMap.values());

  const grandTotals = rows.reduce(
    (acc, row) => ({
      current: Math.round((acc.current + row.current) * 100) / 100,
      days30: Math.round((acc.days30 + row.days30) * 100) / 100,
      days60: Math.round((acc.days60 + row.days60) * 100) / 100,
      days90: Math.round((acc.days90 + row.days90) * 100) / 100,
      days90plus: Math.round((acc.days90plus + row.days90plus) * 100) / 100,
      total: Math.round((acc.total + row.total) * 100) / 100,
    }),
    { current: 0, days30: 0, days60: 0, days90: 0, days90plus: 0, total: 0 },
  );

  return { rows, grandTotals };
}

// ─── getAgedCreditors ─────────────────────────────────────────────────────────

type CreditorBucket = {
  supplierId: string;
  supplierName: string;
  current: number;
  days30: number;
  days60: number;
  days90: number;
  days90plus: number;
  total: number;
};

export async function getAgedCreditors(): Promise<{
  rows: CreditorBucket[];
  grandTotals: Omit<CreditorBucket, "supplierId" | "supplierName">;
}> {
  const now = new Date();

  const unpaidBills = await prisma.bill.findMany({
    where: {
      status: { notIn: ["paid", "void", "draft"] },
    },
    include: {
      supplier: { select: { id: true, name: true } },
    },
  });

  const bucketMap = new Map<string, CreditorBucket>();

  for (const bill of unpaidBills) {
    const supplierId = bill.supplierId;
    if (!bucketMap.has(supplierId)) {
      bucketMap.set(supplierId, {
        supplierId,
        supplierName: bill.supplier.name,
        current: 0,
        days30: 0,
        days60: 0,
        days90: 0,
        days90plus: 0,
        total: 0,
      });
    }

    const bucket = bucketMap.get(supplierId)!;
    const amount = Number(bill.amountDue);
    const key = classifyDaysOverdue(bill.dueDate, now);
    bucket[key] = Math.round((bucket[key] + amount) * 100) / 100;
    bucket.total = Math.round((bucket.total + amount) * 100) / 100;
  }

  const rows = Array.from(bucketMap.values());

  const grandTotals = rows.reduce(
    (acc, row) => ({
      current: Math.round((acc.current + row.current) * 100) / 100,
      days30: Math.round((acc.days30 + row.days30) * 100) / 100,
      days60: Math.round((acc.days60 + row.days60) * 100) / 100,
      days90: Math.round((acc.days90 + row.days90) * 100) / 100,
      days90plus: Math.round((acc.days90plus + row.days90plus) * 100) / 100,
      total: Math.round((acc.total + row.total) * 100) / 100,
    }),
    { current: 0, days30: 0, days60: 0, days90: 0, days90plus: 0, total: 0 },
  );

  return { rows, grandTotals };
}

// ─── generateCustomerStatement ────────────────────────────────────────────────

export async function generateCustomerStatement(accountId: string) {
  const invoices = await prisma.invoice.findMany({
    where: { accountId },
    orderBy: { issueDate: "asc" },
    include: {
      allocations: {
        include: {
          payment: { select: { id: true, paymentRef: true, receivedAt: true, amount: true } },
        },
      },
    },
  });

  let runningBalance = 0;

  const lines: Array<{
    date: Date;
    type: "invoice" | "payment";
    ref: string;
    amount: number;
    balance: number;
  }> = [];

  for (const invoice of invoices) {
    const invoiceAmount = Number(invoice.totalAmount);
    runningBalance = Math.round((runningBalance + invoiceAmount) * 100) / 100;
    lines.push({
      date: invoice.issueDate,
      type: "invoice",
      ref: invoice.invoiceRef,
      amount: invoiceAmount,
      balance: runningBalance,
    });

    for (const allocation of invoice.allocations) {
      if (allocation.payment) {
        const paymentAmount = Number(allocation.amount);
        runningBalance = Math.round((runningBalance - paymentAmount) * 100) / 100;
        lines.push({
          date: allocation.payment.receivedAt ?? new Date(),
          type: "payment",
          ref: allocation.payment.paymentRef,
          amount: -paymentAmount,
          balance: runningBalance,
        });
      }
    }
  }

  return { accountId, lines, closingBalance: runningBalance };
}
