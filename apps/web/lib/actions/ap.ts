"use server";

import { nanoid } from "nanoid";
import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { sendEmail, composeApprovalEmail } from "@/lib/email";
import type { CreateSupplierInput, CreateBillInput, CreatePOInput, CreatePaymentRunInput } from "@/lib/ap-validation";

// ─── Auth guard ───────────────────────────────────────────────────────────────

async function requireManageFinance(): Promise<string> {
  const session = await auth();
  const user = session?.user;
  if (!user || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_finance")) {
    throw new Error("Unauthorized");
  }
  return user.id;
}

// ─── createSupplier ───────────────────────────────────────────────────────────

export async function createSupplier(input: CreateSupplierInput) {
  await requireManageFinance();

  const supplierId = `SUP-${nanoid(8)}`;

  const supplier = await prisma.supplier.create({
    data: {
      supplierId,
      name: input.name,
      contactName: input.contactName ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      taxId: input.taxId ?? null,
      paymentTerms: input.paymentTerms ?? "Net 30",
      defaultCurrency: input.defaultCurrency ?? "USD",
      notes: input.notes ?? null,
      status: "active",
    },
  });

  revalidatePath("/finance/ap");
  revalidatePath("/finance/ap/suppliers");

  return supplier;
}

// ─── getSupplier ──────────────────────────────────────────────────────────────

export async function getSupplier(id: string) {
  await requireManageFinance();

  return prisma.supplier.findUnique({
    where: { id },
    include: {
      bills: {
        select: { id: true, billRef: true, status: true, totalAmount: true, dueDate: true },
        orderBy: { createdAt: "desc" },
        take: 10,
      },
      purchaseOrders: {
        select: { id: true, poNumber: true, status: true, totalAmount: true },
        orderBy: { createdAt: "desc" },
        take: 10,
      },
      _count: { select: { bills: true, purchaseOrders: true } },
    },
  });
}

// ─── listSuppliers ────────────────────────────────────────────────────────────

export async function listSuppliers() {
  await requireManageFinance();

  return prisma.supplier.findMany({
    include: {
      _count: { select: { bills: true } },
    },
    orderBy: { name: "asc" },
  });
}

// ─── Total calculation helpers ────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface LineItemCalc {
  subtotal: number;
  taxAmount: number;
  lineTotal: number;
}

function calcLineItem(quantity: number, unitPrice: number, taxRate: number): LineItemCalc {
  const subtotal = round2(quantity * unitPrice);
  const taxAmount = round2(subtotal * (taxRate / 100));
  const lineTotal = round2(subtotal + taxAmount);
  return { subtotal, taxAmount, lineTotal };
}

// ─── Bill ref generator ───────────────────────────────────────────────────────

async function generateBillRef(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.bill.count();
  const seq = String(count + 1).padStart(4, "0");
  return `BILL-${year}-${seq}`;
}

// ─── createBill ───────────────────────────────────────────────────────────────

export async function createBill(input: CreateBillInput) {
  const userId = await requireManageFinance();

  const billRef = await generateBillRef();

  let subtotal = 0;
  let taxAmount = 0;
  let totalAmount = 0;

  const lineItemsData = input.lineItems.map((item, idx) => {
    const calc = calcLineItem(item.quantity, item.unitPrice, item.taxRate ?? 0);
    subtotal = round2(subtotal + calc.subtotal);
    taxAmount = round2(taxAmount + calc.taxAmount);
    totalAmount = round2(totalAmount + calc.lineTotal);

    return {
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      taxRate: item.taxRate ?? 0,
      taxAmount: calc.taxAmount,
      lineTotal: calc.lineTotal,
      accountCode: item.accountCode ?? null,
      sortOrder: idx,
    };
  });

  const bill = await prisma.bill.create({
    data: {
      billRef,
      supplierId: input.supplierId,
      invoiceRef: input.invoiceRef ?? null,
      issueDate: new Date(input.issueDate),
      dueDate: new Date(input.dueDate),
      currency: input.currency ?? "USD",
      purchaseOrderId: input.purchaseOrderId ?? null,
      notes: input.notes ?? null,
      status: "draft",
      subtotal,
      taxAmount,
      totalAmount,
      amountPaid: 0,
      amountDue: totalAmount,
      createdById: userId,
      lineItems: {
        create: lineItemsData,
      },
    },
    select: { id: true, billRef: true, totalAmount: true },
  });

  revalidatePath("/finance/ap");
  revalidatePath("/finance/ap/bills");

  return bill;
}

// ─── getBill ──────────────────────────────────────────────────────────────────

export async function getBill(id: string) {
  await requireManageFinance();

  return prisma.bill.findUnique({
    where: { id },
    include: {
      lineItems: { orderBy: { sortOrder: "asc" } },
      supplier: { select: { id: true, supplierId: true, name: true } },
      approvals: {
        include: {
          approver: { select: { id: true, email: true } },
        },
      },
      allocations: {
        include: {
          payment: { select: { id: true, paymentRef: true, amount: true } },
        },
      },
    },
  });
}

// ─── listBills ────────────────────────────────────────────────────────────────

interface ListBillsFilters {
  status?: string;
  supplierId?: string;
}

export async function listBills(filters?: ListBillsFilters) {
  await requireManageFinance();

  const where: Record<string, unknown> = {};
  if (filters?.status) where.status = filters.status;
  if (filters?.supplierId) where.supplierId = filters.supplierId;

  return prisma.bill.findMany({
    where,
    include: {
      supplier: { select: { id: true, supplierId: true, name: true } },
      lineItems: { orderBy: { sortOrder: "asc" } },
    },
    orderBy: { createdAt: "desc" },
  });
}

// ─── submitBillForApproval ────────────────────────────────────────────────────

export async function submitBillForApproval(billId: string): Promise<void> {
  await requireManageFinance();

  const bill = await prisma.bill.findUnique({
    where: { id: billId },
    include: {
      supplier: { select: { name: true, email: true } },
    },
  });
  if (!bill) throw new Error("Bill not found");

  // Find matching approval rules by amount
  const totalAmount = Number(bill.totalAmount);
  const rules = await prisma.approvalRule.findMany({
    where: {
      isActive: true,
      minAmount: { lte: totalAmount },
      OR: [{ maxAmount: null }, { maxAmount: { gte: totalAmount } }],
    },
    include: {
      approver: { select: { id: true, email: true } },
    },
  });

  // Create a BillApproval record per matching rule
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  for (const rule of rules) {
    const token = nanoid(32);
    await prisma.billApproval.create({
      data: {
        billId,
        approverId: rule.approverId,
        token,
        status: "pending",
      },
    });

    // Send approval email
    const approveUrl = `${baseUrl}/finance/ap/approvals/${token}`;
    const emailPayload = composeApprovalEmail({
      to: rule.approver.email,
      billRef: bill.billRef,
      supplierName: bill.supplier.name,
      totalAmount: totalAmount.toFixed(2),
      currency: bill.currency,
      approveUrl,
    });
    await sendEmail(emailPayload);
  }

  await prisma.bill.update({
    where: { id: billId },
    data: { status: "awaiting_approval" },
  });

  revalidatePath("/finance/ap");
  revalidatePath("/finance/ap/bills");
}

// ─── respondToBillApproval ────────────────────────────────────────────────────

export async function respondToBillApproval(
  token: string,
  approved: boolean,
  comments?: string,
): Promise<void> {
  // Token-based — no session auth required
  const approval = await prisma.billApproval.findUnique({ where: { token } });
  if (!approval) throw new Error("Approval not found");

  const newStatus = approved ? "approved" : "rejected";

  await prisma.billApproval.update({
    where: { token },
    data: {
      status: newStatus,
      respondedAt: new Date(),
      comments: comments ?? null,
    },
  });

  // Check if all approvals for this bill have been resolved
  const allApprovals = await prisma.billApproval.findMany({
    where: { billId: approval.billId },
  });

  const anyRejected = allApprovals.some((a) => a.status === "rejected");
  const allApproved = allApprovals.every((a) => a.status === "approved");

  if (anyRejected) {
    await prisma.bill.update({
      where: { id: approval.billId },
      data: { status: "draft" },
    });
  } else if (allApproved) {
    await prisma.bill.update({
      where: { id: approval.billId },
      data: { status: "approved" },
    });
  }
}

// ─── getBillByApprovalToken ───────────────────────────────────────────────────

export async function getBillByApprovalToken(token: string) {
  const approval = await prisma.billApproval.findUnique({
    where: { token },
    include: {
      bill: {
        include: {
          lineItems: { orderBy: { sortOrder: "asc" } },
          supplier: { select: { id: true, name: true } },
        },
      },
    },
  });
  return approval;
}

// ─── PO ref generator ─────────────────────────────────────────────────────────

async function generatePORef(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.purchaseOrder.count();
  const seq = String(count + 1).padStart(4, "0");
  return `PO-${year}-${seq}`;
}

// ─── createPurchaseOrder ──────────────────────────────────────────────────────

export async function createPurchaseOrder(input: CreatePOInput) {
  const userId = await requireManageFinance();

  const poNumber = await generatePORef();

  let subtotal = 0;
  let taxAmount = 0;
  let totalAmount = 0;

  const lineItemsData = input.lineItems.map((item, idx) => {
    const calc = calcLineItem(item.quantity, item.unitPrice, item.taxRate ?? 0);
    subtotal = round2(subtotal + calc.subtotal);
    taxAmount = round2(taxAmount + calc.taxAmount);
    totalAmount = round2(totalAmount + calc.lineTotal);

    return {
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      taxRate: item.taxRate ?? 0,
      taxAmount: calc.taxAmount,
      lineTotal: calc.lineTotal,
      sortOrder: idx,
    };
  });

  const po = await prisma.purchaseOrder.create({
    data: {
      poNumber,
      supplierId: input.supplierId,
      currency: input.currency ?? "USD",
      deliveryDate: input.deliveryDate ? new Date(input.deliveryDate) : null,
      terms: input.terms ?? null,
      notes: input.notes ?? null,
      status: "draft",
      subtotal,
      taxAmount,
      totalAmount,
      createdById: userId,
      lineItems: {
        create: lineItemsData,
      },
    },
    select: { id: true, poNumber: true, totalAmount: true },
  });

  revalidatePath("/finance/ap");
  revalidatePath("/finance/ap/purchase-orders");

  return po;
}

// ─── getPurchaseOrder ─────────────────────────────────────────────────────────

export async function getPurchaseOrder(id: string) {
  await requireManageFinance();

  return prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      lineItems: { orderBy: { sortOrder: "asc" } },
      supplier: { select: { id: true, supplierId: true, name: true } },
      bills: { select: { id: true, billRef: true, status: true, totalAmount: true } },
    },
  });
}

// ─── listPurchaseOrders ───────────────────────────────────────────────────────

interface ListPOFilters {
  status?: string;
  supplierId?: string;
}

export async function listPurchaseOrders(filters?: ListPOFilters) {
  await requireManageFinance();

  const where: Record<string, unknown> = {};
  if (filters?.status) where.status = filters.status;
  if (filters?.supplierId) where.supplierId = filters.supplierId;

  return prisma.purchaseOrder.findMany({
    where,
    include: {
      supplier: { select: { id: true, supplierId: true, name: true } },
      lineItems: { orderBy: { sortOrder: "asc" } },
    },
    orderBy: { createdAt: "desc" },
  });
}

// ─── sendPurchaseOrder ────────────────────────────────────────────────────────

export async function sendPurchaseOrder(poId: string): Promise<void> {
  await requireManageFinance();

  await prisma.purchaseOrder.update({
    where: { id: poId },
    data: { status: "sent", sentAt: new Date() },
  });

  revalidatePath("/finance/ap");
  revalidatePath("/finance/ap/purchase-orders");
}

// ─── convertPOToBill ──────────────────────────────────────────────────────────

export async function convertPOToBill(poId: string) {
  await requireManageFinance();

  // Idempotency: check if a bill already exists for this PO
  const existing = await prisma.bill.findFirst({
    where: { purchaseOrderId: poId },
  });
  if (existing) return existing;

  const po = await prisma.purchaseOrder.findUnique({
    where: { id: poId },
    include: { lineItems: { orderBy: { sortOrder: "asc" } } },
  });
  if (!po) throw new Error("Purchase order not found");

  const billRef = await generateBillRef();

  const today = new Date();
  const dueDate = new Date(today.getTime() + 30 * 86400000); // Net 30 default

  const bill = await prisma.bill.create({
    data: {
      billRef,
      supplierId: po.supplierId,
      purchaseOrderId: po.id,
      issueDate: today,
      dueDate,
      currency: po.currency,
      status: "draft",
      subtotal: po.subtotal,
      taxAmount: po.taxAmount,
      totalAmount: po.totalAmount,
      amountPaid: 0,
      amountDue: po.totalAmount,
      lineItems: {
        create: po.lineItems.map((li, idx) => ({
          description: li.description,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          taxRate: li.taxRate,
          taxAmount: li.taxAmount,
          lineTotal: li.lineTotal,
          sortOrder: idx,
        })),
      },
    },
  });

  revalidatePath("/finance/ap");
  revalidatePath("/finance/ap/bills");

  return bill;
}

// ─── Payment ref generator ────────────────────────────────────────────────────

async function generatePaymentRef(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.payment.count();
  const seq = String(count + 1).padStart(4, "0");
  return `PAY-${year}-${seq}`;
}

// ─── createPaymentRun ─────────────────────────────────────────────────────────

export async function createPaymentRun(input: CreatePaymentRunInput) {
  const userId = await requireManageFinance();

  // Load all specified bills
  const bills = await prisma.bill.findMany({
    where: { id: { in: input.billIds } },
  });

  // Verify all bills are approved
  const nonApproved = bills.filter((b) => b.status !== "approved");
  if (nonApproved.length > 0) {
    throw new Error(
      `All bills must be approved before payment. Non-approved bills: ${nonApproved.map((b) => b.billRef ?? b.id).join(", ")}`,
    );
  }

  if (input.consolidatePerSupplier) {
    // Group bills by supplier
    const groups = new Map<string, typeof bills>();
    for (const bill of bills) {
      const group = groups.get(bill.supplierId) ?? [];
      group.push(bill);
      groups.set(bill.supplierId, group);
    }

    for (const [, groupBills] of groups) {
      const groupTotal = round2(
        groupBills.reduce((sum, b) => sum + Number(b.amountDue), 0),
      );
      const currency = groupBills[0]!.currency;
      const paymentRef = await generatePaymentRef();

      const payment = await prisma.payment.create({
        data: {
          paymentRef,
          direction: "outbound",
          method: "bank_transfer",
          status: "completed",
          amount: groupTotal,
          currency,
          createdById: userId,
          receivedAt: new Date(),
        },
        select: { id: true, paymentRef: true },
      });

      for (const bill of groupBills) {
        await prisma.paymentAllocation.create({
          data: {
            paymentId: payment.id,
            billId: bill.id,
            amount: Number(bill.amountDue),
          },
        });

        await prisma.bill.update({
          where: { id: bill.id },
          data: {
            amountPaid: Number(bill.totalAmount),
            amountDue: 0,
            status: "paid",
          },
        });
      }
    }
  } else {
    // Create a separate payment per bill
    for (const bill of bills) {
      const paymentRef = await generatePaymentRef();

      const payment = await prisma.payment.create({
        data: {
          paymentRef,
          direction: "outbound",
          method: "bank_transfer",
          status: "completed",
          amount: Number(bill.amountDue),
          currency: bill.currency,
          createdById: userId,
          receivedAt: new Date(),
        },
        select: { id: true, paymentRef: true },
      });

      await prisma.paymentAllocation.create({
        data: {
          paymentId: payment.id,
          billId: bill.id,
          amount: Number(bill.amountDue),
        },
      });

      await prisma.bill.update({
        where: { id: bill.id },
        data: {
          amountPaid: Number(bill.totalAmount),
          amountDue: 0,
          status: "paid",
        },
      });
    }
  }

  revalidatePath("/finance/ap");
  revalidatePath("/finance/ap/payment-runs");
}

// ─── listPaymentRuns ──────────────────────────────────────────────────────────

export async function listPaymentRuns() {
  await requireManageFinance();

  return prisma.payment.findMany({
    where: { direction: "outbound" },
    include: {
      allocations: {
        include: {
          bill: { select: { id: true, billRef: true, supplierId: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}
