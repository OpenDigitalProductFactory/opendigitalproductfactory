"use server";

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { nanoid } from "nanoid";
import { createInvoice, sendInvoice } from "@/lib/actions/finance";
import type { CreateRecurringScheduleInput } from "@/lib/recurring-validation";

// ─── Auth guard ───────────────────────────────────────────────────────────────

async function requireManageFinance(): Promise<string> {
  const session = await auth();
  const user = session?.user;
  if (
    !user ||
    !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_finance")
  ) {
    throw new Error("Unauthorized");
  }
  return user.id;
}

// ─── calculateNextDate ────────────────────────────────────────────────────────
// Pure utility — lives in recurring-utils (no "use server" constraint).
// Re-exported here so existing callers don't need to change their import path.
import { calculateNextDate } from "@/lib/recurring-utils";
export { calculateNextDate };

// ─── createRecurringSchedule ──────────────────────────────────────────────────

export async function createRecurringSchedule(
  input: CreateRecurringScheduleInput,
): Promise<{ id: string; scheduleId: string }> {
  const userId = await requireManageFinance();

  const scheduleId = `REC-${nanoid(8)}`;

  // Calculate total amount from line items (qty * unitPrice * (1 + taxRate/100))
  const amount = input.lineItems.reduce((sum, item) => {
    const lineTotal = item.quantity * item.unitPrice * (1 + (item.taxRate ?? 0) / 100);
    return sum + Math.round(lineTotal * 100) / 100;
  }, 0);

  const schedule = await prisma.recurringSchedule.create({
    data: {
      scheduleId,
      accountId: input.accountId,
      name: input.name,
      frequency: input.frequency,
      amount,
      currency: input.currency ?? "USD",
      startDate: new Date(input.startDate),
      endDate: input.endDate ? new Date(input.endDate) : null,
      nextInvoiceDate: new Date(input.startDate),
      status: "active",
      autoSend: input.autoSend ?? true,
      templateNotes: input.templateNotes ?? null,
      createdById: userId,
      lineItems: {
        create: input.lineItems.map((item, idx) => ({
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          taxRate: item.taxRate ?? 0,
          sortOrder: idx,
        })),
      },
    },
    select: { id: true, scheduleId: true },
  });

  revalidatePath("/finance");
  revalidatePath("/finance/recurring");

  return schedule;
}

// ─── getRecurringSchedule ─────────────────────────────────────────────────────

export async function getRecurringSchedule(id: string) {
  await requireManageFinance();

  const schedule = await prisma.recurringSchedule.findUnique({
    where: { id },
    include: {
      lineItems: { orderBy: { sortOrder: "asc" } },
      account: { select: { id: true, accountId: true, name: true } },
      createdBy: { select: { id: true, email: true } },
    },
  });

  if (!schedule) return null;

  // Fetch recent generated invoices for this schedule
  const generatedInvoices = await prisma.invoice.findMany({
    where: { sourceType: "recurring", sourceId: schedule.id },
    orderBy: { issueDate: "desc" },
    take: 12,
    select: {
      id: true,
      invoiceRef: true,
      status: true,
      totalAmount: true,
      issueDate: true,
      dueDate: true,
    },
  });

  return { ...schedule, generatedInvoices };
}

// ─── listRecurringSchedules ───────────────────────────────────────────────────

interface ListSchedulesFilters {
  status?: string;
}

export async function listRecurringSchedules(filters?: ListSchedulesFilters) {
  await requireManageFinance();

  const where: Record<string, unknown> = {};
  if (filters?.status) where.status = filters.status;

  return prisma.recurringSchedule.findMany({
    where,
    include: {
      account: { select: { id: true, accountId: true, name: true } },
    },
    orderBy: { nextInvoiceDate: "asc" },
  });
}

// ─── updateScheduleStatus ─────────────────────────────────────────────────────

export async function updateScheduleStatus(
  id: string,
  status: "active" | "paused" | "cancelled" | "completed",
): Promise<void> {
  await requireManageFinance();

  await prisma.recurringSchedule.update({
    where: { id },
    data: { status },
  });

  revalidatePath("/finance");
  revalidatePath("/finance/recurring");
}

// ─── generateDueInvoices ──────────────────────────────────────────────────────

export async function generateDueInvoices(): Promise<{ generated: number; sent: number }> {
  const now = new Date();
  let generated = 0;
  let sent = 0;

  const dueSchedules = await prisma.recurringSchedule.findMany({
    where: {
      status: "active",
      nextInvoiceDate: { lte: now },
    },
    include: {
      lineItems: { orderBy: { sortOrder: "asc" } },
    },
  });

  for (const schedule of dueSchedules) {
    // Idempotency: check if invoice already exists for this period
    const issueDate = schedule.nextInvoiceDate;
    const startOfDay = new Date(issueDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(issueDate);
    endOfDay.setHours(23, 59, 59, 999);

    const existing = await prisma.invoice.findFirst({
      where: {
        sourceType: "recurring",
        sourceId: schedule.id,
        issueDate: { gte: startOfDay, lte: endOfDay },
      },
    });

    if (existing) continue;

    // Build invoice line items from schedule line items
    const lineItems = schedule.lineItems.map((li) => ({
      description: li.description,
      quantity: Number(li.quantity),
      unitPrice: Number(li.unitPrice),
      discountPercent: 0,
      taxRate: Number(li.taxRate),
    }));

    // Create the invoice (30-day payment terms by default)
    const dueDate = new Date(issueDate);
    dueDate.setDate(dueDate.getDate() + 30);

    const invoice = await createInvoice({
      accountId: schedule.accountId,
      type: "recurring_instance",
      dueDate: dueDate.toISOString().split("T")[0]!,
      currency: schedule.currency,
      sourceType: "recurring",
      sourceId: schedule.id,
      lineItems,
    });

    generated++;

    // Auto-send if configured
    if (schedule.autoSend) {
      await sendInvoice(invoice.id);
      sent++;
    }

    // Advance nextInvoiceDate
    const nextDate = calculateNextDate(schedule.nextInvoiceDate, schedule.frequency);

    // Check if schedule is completed
    const isCompleted = schedule.endDate != null && nextDate > schedule.endDate;

    await prisma.recurringSchedule.update({
      where: { id: schedule.id },
      data: {
        nextInvoiceDate: nextDate,
        lastInvoicedAt: now,
        status: isCompleted ? "completed" : "active",
      },
    });
  }

  return { generated, sent };
}
