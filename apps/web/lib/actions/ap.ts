"use server";

import { nanoid } from "nanoid";
import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import type { CreateSupplierInput } from "@/lib/ap-validation";

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
      defaultCurrency: input.defaultCurrency ?? "GBP",
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
