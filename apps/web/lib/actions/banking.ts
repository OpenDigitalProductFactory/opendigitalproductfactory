"use server";

import { nanoid } from "nanoid";
import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { parseCSV } from "@/lib/csv-parser";
import { findMatches, applyBankRules } from "@/lib/matching-engine";
import type { CreateBankAccountInput, CreateBankRuleInput } from "@/lib/banking-validation";

// ─── Auth guard ───────────────────────────────────────────────────────────────

async function requireManageFinance(): Promise<string> {
  const session = await auth();
  const user = session?.user;
  if (!user || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_finance")) {
    throw new Error("Unauthorized");
  }
  return user.id;
}

// ─── createBankAccount ────────────────────────────────────────────────────────

export async function createBankAccount(input: CreateBankAccountInput) {
  await requireManageFinance();

  const bankAccountId = `BA-${nanoid(8)}`;
  const openingBalance = input.openingBalance ?? 0;

  const account = await prisma.bankAccount.create({
    data: {
      bankAccountId,
      name: input.name,
      bankName: input.bankName ?? null,
      accountNumber: input.accountNumber ?? null,
      sortCode: input.sortCode ?? null,
      iban: input.iban ?? null,
      swift: input.swift ?? null,
      currency: input.currency ?? "GBP",
      accountType: input.accountType ?? "current",
      openingBalance,
      currentBalance: openingBalance,
      status: "active",
    },
  });

  revalidatePath("/finance/banking");

  return account;
}

// ─── getBankAccount ───────────────────────────────────────────────────────────

export async function getBankAccount(id: string) {
  await requireManageFinance();

  return prisma.bankAccount.findUnique({
    where: { id },
    include: {
      transactions: {
        orderBy: { transactionDate: "desc" },
        take: 50,
      },
      _count: {
        select: {
          transactions: {
            where: { matchStatus: "unmatched" },
          },
        },
      },
    },
  });
}

// ─── listBankAccounts ─────────────────────────────────────────────────────────

export async function listBankAccounts() {
  await requireManageFinance();

  return prisma.bankAccount.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: {
        select: {
          transactions: {
            where: { matchStatus: "unmatched" },
          },
        },
      },
    },
  });
}

// ─── importTransactions ───────────────────────────────────────────────────────

export async function importTransactions(
  bankAccountId: string,
  csvContent: string,
): Promise<{ imported: number; errors: Array<{ row: number; message: string }>; batchId: string }> {
  await requireManageFinance();

  const parseResult = parseCSV(csvContent);
  const batchId = nanoid(12);

  // Load active bank rules for auto-categorization
  const rules = await prisma.bankRule.findMany({
    where: { isActive: true },
  });

  let imported = 0;
  let lastBalance: number | undefined;

  for (const tx of parseResult.transactions) {
    const ruleMatch = applyBankRules(
      { description: tx.description, reference: tx.reference, amount: tx.amount },
      rules.map((r) => ({ ...r, taxRate: r.taxRate ? Number(r.taxRate) : null })),
    );

    await prisma.bankTransaction.create({
      data: {
        bankAccountId,
        transactionDate: tx.date,
        description: tx.description,
        amount: tx.amount,
        balance: tx.balance ?? null,
        reference: tx.reference ?? null,
        category: ruleMatch?.category ?? null,
        matchStatus: "unmatched",
        importBatchId: batchId,
      },
    });

    imported++;

    if (tx.balance !== undefined) {
      lastBalance = tx.balance;
    }
  }

  // Update account balance if we have balance data
  if (lastBalance !== undefined) {
    await prisma.bankAccount.update({
      where: { id: bankAccountId },
      data: { currentBalance: lastBalance },
    });
  } else if (imported > 0) {
    // Calculate running balance from transaction amounts
    const amounts = parseResult.transactions.map((t) => t.amount);
    const netChange = amounts.reduce((sum, a) => sum + a, 0);

    const account = await prisma.bankAccount.findUnique({
      where: { id: bankAccountId },
      select: { currentBalance: true },
    });

    if (account) {
      await prisma.bankAccount.update({
        where: { id: bankAccountId },
        data: { currentBalance: Number(account.currentBalance) + netChange },
      });
    }
  }

  return { imported, errors: parseResult.errors, batchId };
}

// ─── getTransactions ──────────────────────────────────────────────────────────

interface GetTransactionsFilters {
  matchStatus?: string;
}

export async function getTransactions(bankAccountId: string, filters?: GetTransactionsFilters) {
  await requireManageFinance();

  const where: Record<string, unknown> = { bankAccountId };
  if (filters?.matchStatus) where.matchStatus = filters.matchStatus;

  return prisma.bankTransaction.findMany({
    where,
    orderBy: { transactionDate: "desc" },
  });
}

// ─── matchTransaction ─────────────────────────────────────────────────────────

export async function matchTransaction(transactionId: string, paymentId: string): Promise<void> {
  await requireManageFinance();

  await prisma.bankTransaction.update({
    where: { id: transactionId },
    data: {
      matchStatus: "matched",
      matchedPaymentId: paymentId,
    },
  });

  await prisma.payment.update({
    where: { id: paymentId },
    data: {
      reconciled: true,
      reconciledAt: new Date(),
    },
  });

  revalidatePath("/finance/banking");
}

// ─── unmatchTransaction ───────────────────────────────────────────────────────

export async function unmatchTransaction(transactionId: string): Promise<void> {
  await requireManageFinance();

  const transaction = await prisma.bankTransaction.findUnique({
    where: { id: transactionId },
    select: { matchedPaymentId: true },
  });

  await prisma.bankTransaction.update({
    where: { id: transactionId },
    data: {
      matchStatus: "unmatched",
      matchedPaymentId: null,
    },
  });

  if (transaction?.matchedPaymentId) {
    await prisma.payment.update({
      where: { id: transaction.matchedPaymentId },
      data: {
        reconciled: false,
        reconciledAt: null,
      },
    });
  }

  revalidatePath("/finance/banking");
}

// ─── suggestMatches ───────────────────────────────────────────────────────────

export async function suggestMatches(transactionId: string) {
  await requireManageFinance();

  const transaction = await prisma.bankTransaction.findUnique({
    where: { id: transactionId },
  });

  if (!transaction) {
    throw new Error("Transaction not found");
  }

  const unreconciledPayments = await prisma.payment.findMany({
    where: {
      reconciled: false,
      direction: "inbound",
    },
    select: {
      id: true,
      paymentRef: true,
      amount: true,
      receivedAt: true,
      counterpartyId: true,
      reference: true,
    },
  });

  const candidates = findMatches(
    {
      amount: Number(transaction.amount),
      date: transaction.transactionDate,
      description: transaction.description,
      reference: transaction.reference ?? undefined,
    },
    unreconciledPayments.map((p) => ({
      id: p.id,
      paymentRef: p.paymentRef,
      amount: Number(p.amount),
      receivedAt: p.receivedAt,
      counterpartyId: p.counterpartyId,
      reference: p.reference,
    })),
  );

  return candidates;
}

// ─── createBankRule ───────────────────────────────────────────────────────────

export async function createBankRule(input: CreateBankRuleInput) {
  await requireManageFinance();

  const rule = await prisma.bankRule.create({
    data: {
      name: input.name,
      matchField: input.matchField,
      matchType: input.matchType ?? "contains",
      matchValue: input.matchValue,
      accountCode: input.accountCode ?? null,
      category: input.category ?? null,
      taxRate: input.taxRate ?? null,
      description: input.description ?? null,
      isActive: true,
    },
  });

  revalidatePath("/finance/banking");

  return rule;
}

// ─── listBankRules ────────────────────────────────────────────────────────────

export async function listBankRules() {
  await requireManageFinance();

  return prisma.bankRule.findMany({
    orderBy: { hitCount: "desc" },
  });
}

// ─── deleteBankRule ───────────────────────────────────────────────────────────

export async function deleteBankRule(id: string): Promise<void> {
  await requireManageFinance();

  await prisma.bankRule.delete({
    where: { id },
  });

  revalidatePath("/finance/banking/rules");
}

// ─── getReconciliationSummary ─────────────────────────────────────────────────

export async function getReconciliationSummary(bankAccountId: string) {
  await requireManageFinance();

  const [unmatchedCount, totalCount, account] = await Promise.all([
    prisma.bankTransaction.count({
      where: { bankAccountId, matchStatus: "unmatched" },
    }),
    prisma.bankTransaction.count({
      where: { bankAccountId },
    }),
    prisma.bankAccount.findUnique({
      where: { id: bankAccountId },
      select: { currentBalance: true, lastReconciledAt: true },
    }),
  ]);

  return {
    unmatchedCount,
    totalCount,
    currentBalance: account ? Number(account.currentBalance) : 0,
    lastReconciledAt: account?.lastReconciledAt ?? null,
  };
}
