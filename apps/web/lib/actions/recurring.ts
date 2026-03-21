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

export function calculateNextDate(currentDate: Date, frequency: string): Date {
  // Work in UTC to avoid timezone-driven date drift
  const y = currentDate.getUTCFullYear();
  const m = currentDate.getUTCMonth();
  const d = currentDate.getUTCDate();

  switch (frequency) {
    case "weekly":
      return new Date(Date.UTC(y, m, d + 7));
    case "fortnightly":
      return new Date(Date.UTC(y, m, d + 14));
    case "monthly":
      return addMonthsUTC(y, m, d, 1);
    case "quarterly":
      return addMonthsUTC(y, m, d, 3);
    case "annually":
      return addMonthsUTC(y, m + 12, d, 0);
    default:
      throw new Error(`Unknown frequency: ${frequency}`);
  }
}

function addMonthsUTC(year: number, month: number, day: number, addMonths: number): Date {
  // Target month (JavaScript handles year rollover automatically)
  const targetMonth = month + addMonths;
  // Find last day of target month using Date.UTC with day=0 of next month
  const lastDayOfMonth = new Date(Date.UTC(year, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, targetMonth, Math.min(day, lastDayOfMonth)));
}

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
      currency: input.currency ?? "GBP",
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
      taxRate: Number(li.taxRate),
    }));

    // Create the invoice (30-day payment terms by default)
    const dueDate = new Date(issueDate);
    dueDate.setDate(dueDate.getDate() + 30);

    const invoice = await createInvoice({
      accountId: schedule.accountId,
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
