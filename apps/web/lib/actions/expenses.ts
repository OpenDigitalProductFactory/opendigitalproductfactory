"use server";

import { nanoid } from "nanoid";
import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { sendEmail, composeExpenseApprovalEmail } from "@/lib/email";
import type { CreateExpenseClaimInput } from "@/lib/expense-validation";

// ─── Auth helpers ─────────────────────────────────────────────────────────────

async function getSessionUser() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  return session.user;
}

async function requireManageFinance(): Promise<string> {
  const session = await auth();
  const user = session?.user;
  if (!user || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_finance")) {
    throw new Error("Unauthorized");
  }
  return user.id;
}

// ─── Claim ref generator ──────────────────────────────────────────────────────

async function generateClaimId(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.expenseClaim.count();
  const seq = String(count + 1).padStart(4, "0");
  return `EXP-${year}-${seq}`;
}

// ─── createExpenseClaim ───────────────────────────────────────────────────────

export async function createExpenseClaim(input: CreateExpenseClaimInput) {
  const user = await getSessionUser();

  // Look up employee profile by session userId
  const employeeProfile = await prisma.employeeProfile.findFirst({
    where: { userId: user.id },
  });
  if (!employeeProfile) throw new Error("Employee profile not found for current user");

  const claimId = await generateClaimId();

  // Calculate totalAmount from items
  const totalAmount = input.items.reduce((sum, item) => sum + item.amount, 0);

  const claim = await prisma.expenseClaim.create({
    data: {
      claimId,
      employeeId: employeeProfile.id,
      title: input.title,
      currency: input.currency ?? "GBP",
      notes: input.notes ?? null,
      status: "draft",
      totalAmount,
      items: {
        create: input.items.map((item, idx) => ({
          date: new Date(item.date),
          category: item.category,
          description: item.description,
          amount: item.amount,
          currency: item.currency ?? "GBP",
          receiptUrl: item.receiptUrl ?? null,
          taxReclaimable: item.taxReclaimable ?? false,
          taxAmount: item.taxAmount ?? 0,
          accountCode: item.accountCode ?? null,
          sortOrder: idx,
        })),
      },
    },
    include: { items: true },
  });

  revalidatePath("/finance/expenses");

  return claim;
}

// ─── getExpenseClaim ──────────────────────────────────────────────────────────

export async function getExpenseClaim(id: string) {
  await getSessionUser();

  return prisma.expenseClaim.findUnique({
    where: { id },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      employee: {
        select: { id: true, displayName: true, workEmail: true },
      },
      approvedBy: {
        select: { id: true, email: true },
      },
    },
  });
}

// ─── listExpenseClaims ────────────────────────────────────────────────────────

interface ListExpenseClaimsFilters {
  status?: string;
  employeeOnly?: boolean;
}

export async function listExpenseClaims(filters?: ListExpenseClaimsFilters) {
  const user = await getSessionUser();

  const isManager = can(
    { platformRole: user.platformRole, isSuperuser: user.isSuperuser },
    "manage_finance",
  );

  const where: Record<string, unknown> = {};

  if (filters?.status) where.status = filters.status;

  // Non-managers always see only their own claims; managers can see all unless
  // employeeOnly is explicitly requested
  if (!isManager || filters?.employeeOnly) {
    const employeeProfile = await prisma.employeeProfile.findFirst({
      where: { userId: user.id },
    });
    if (employeeProfile) {
      where.employeeId = employeeProfile.id;
    } else {
      // No employee profile — return nothing
      return [];
    }
  }

  return prisma.expenseClaim.findMany({
    where,
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      employee: { select: { id: true, displayName: true, workEmail: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

// ─── submitExpenseClaim ───────────────────────────────────────────────────────

export async function submitExpenseClaim(id: string): Promise<void> {
  const user = await getSessionUser();

  const claim = await prisma.expenseClaim.findUnique({
    where: { id },
    include: {
      employee: { select: { id: true, displayName: true, workEmail: true, userId: true } },
    },
  });
  if (!claim) throw new Error("Expense claim not found");

  const isManager = can(
    { platformRole: user.platformRole, isSuperuser: user.isSuperuser },
    "manage_finance",
  );

  // Only the owning employee or a manager can submit
  if (!isManager && claim.employee.userId !== user.id) {
    throw new Error("Unauthorized");
  }

  const approvalToken = nanoid(32);

  // Find a user with manage_finance to be the approver (MVP: first match)
  const managers = await prisma.user.findMany({
    where: {
      groups: {
        some: {
          platformRole: {
            roleId: { in: ["HR-000", "HR-200"] },
          },
        },
      },
      isActive: true,
      id: { not: user.id },
    },
    select: { id: true, email: true },
    take: 1,
  });

  await prisma.expenseClaim.update({
    where: { id },
    data: {
      status: "submitted",
      submittedAt: new Date(),
      approvalToken,
    },
  });

  // Send approval email if a manager was found
  if (managers.length > 0) {
    const manager = managers[0]!;
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const approveUrl = `${baseUrl}/finance/expenses/approvals/${approvalToken}`;

    const emailPayload = composeExpenseApprovalEmail({
      to: manager.email,
      claimId: claim.claimId,
      employeeName: claim.employee.displayName,
      title: claim.title,
      totalAmount: Number(claim.totalAmount).toFixed(2),
      currency: claim.currency,
      itemCount: 0, // items count will be fetched separately if needed
      approveUrl,
    });
    await sendEmail(emailPayload);
  }

  revalidatePath("/finance/expenses");
}

// ─── respondToExpenseApproval ─────────────────────────────────────────────────

export async function respondToExpenseApproval(
  token: string,
  approved: boolean,
  reason?: string,
): Promise<void> {
  // Token-based — no session auth required
  const claim = await prisma.expenseClaim.findUnique({ where: { approvalToken: token } });
  if (!claim) throw new Error("Approval not found");

  if (approved) {
    await prisma.expenseClaim.update({
      where: { approvalToken: token },
      data: {
        status: "approved",
        approvedAt: new Date(),
      },
    });
  } else {
    await prisma.expenseClaim.update({
      where: { approvalToken: token },
      data: {
        status: "rejected",
        rejectedReason: reason ?? null,
      },
    });
  }
}

// ─── getExpenseClaimByApprovalToken ───────────────────────────────────────────

export async function getExpenseClaimByApprovalToken(token: string) {
  return prisma.expenseClaim.findUnique({
    where: { approvalToken: token },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      employee: { select: { id: true, displayName: true, workEmail: true } },
    },
  });
}

// ─── markExpenseReimbursed ────────────────────────────────────────────────────

export async function markExpenseReimbursed(claimId: string): Promise<void> {
  await requireManageFinance();

  const claim = await prisma.expenseClaim.findUnique({ where: { id: claimId } });
  if (!claim) throw new Error("Expense claim not found");

  await prisma.expenseClaim.update({
    where: { id: claimId },
    data: {
      status: "paid",
      paidAt: new Date(),
    },
  });

  revalidatePath("/finance/expenses");
}
