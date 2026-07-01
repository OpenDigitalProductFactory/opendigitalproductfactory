// lib/finance/ledger-service.ts — persistence + auto-posting for the General Ledger (AGT-900)
//
// The DB seam that makes the ledger *automatic*: the chart of accounts is seeded
// from the org's financial profile at setup, and finalising a sub-ledger document
// posts a balanced journal entry with no manual step. The accounting rules
// (balancing, account determination) live in the pure, unit-tested siblings
// ./ledger and ./chart-of-accounts; this file only reads/writes Prisma around them.
//
// Single-org install convention: the operating organization is resolved via
// prisma.organization.findFirst() (the same pattern applyFinancialProfile uses).

import { prisma } from "@dpf/db";
import { getFinancialProfile } from "@dpf/finance-templates";
import {
  buildOrgChartOfAccounts,
  resolvePostingAccounts,
  type DeterminableAccount,
} from "./chart-of-accounts";
import {
  buildInvoicePostingLines,
  validateJournalEntry,
  periodKeyOf,
  type LedgerAccountType,
} from "./ledger";

// ─── Chart-of-accounts seeding ───────────────────────────────────────────────

export type SeedChartResult = { seeded: number; total: number; profileSlug: string | null };

/**
 * Seed (idempotently) the org's chart of accounts from its applied financial
 * profile. Called at setup from applyFinancialProfile, and safe to re-run: each
 * account upserts on the unique (organizationId, code), so existing accounts and
 * any user edits to their names are left untouched while missing spine accounts
 * are filled in.
 */
export async function seedChartOfAccounts(organizationId: string): Promise<SeedChartResult> {
  const settings = await prisma.orgSettings.findFirst({ select: { appliedProfileSlug: true } });
  const profile = settings?.appliedProfileSlug
    ? getFinancialProfile(settings.appliedProfileSlug)
    : null;

  // With no profile we still lay down the base control spine so the ledger works.
  const chart = buildOrgChartOfAccounts(profile ?? { chartOfAccountsSeed: [] });

  let seeded = 0;
  for (const account of chart) {
    const existing = await prisma.ledgerAccount.findUnique({
      where: { organizationId_code: { organizationId, code: account.code } },
      select: { id: true },
    });
    if (existing) continue;
    await prisma.ledgerAccount.create({
      data: {
        organizationId,
        code: account.code,
        name: account.name,
        type: account.type,
        normalBalance: account.normalBalance,
        isControl: account.isControl ?? false,
      },
    });
    seeded += 1;
  }

  return { seeded, total: chart.length, profileSlug: settings?.appliedProfileSlug ?? null };
}

// ─── Invoice → GL auto-posting ───────────────────────────────────────────────

export type PostInvoiceResult =
  | { posted: true; journalEntryId: string; entryRef: string }
  | { posted: false; reason: "already-posted" | "no-organization" | "unresolved-accounts"; detail?: string };

/**
 * Post an issued customer invoice to the ledger:
 *   Dr Accounts Receivable (gross) / Cr Revenue (net) / Cr Tax Payable (tax).
 *
 * Idempotent — a second call for the same invoice is a no-op (one journal per
 * source document, keyed on sourceType+sourceId). Account determination is
 * automatic via resolvePostingAccounts; if a required account cannot be resolved
 * the invoice is *not* posted and the missing roles are reported rather than
 * guessed, so the books never silently misstate.
 */
export async function postInvoiceIssued(invoiceId: string): Promise<PostInvoiceResult> {
  const existing = await prisma.journalEntry.findFirst({
    where: { sourceType: "Invoice", sourceId: invoiceId },
    select: { id: true, entryRef: true },
  });
  if (existing) {
    return { posted: false, reason: "already-posted", detail: existing.entryRef };
  }

  const org = await prisma.organization.findFirst({ select: { id: true } });
  if (!org) return { posted: false, reason: "no-organization" };

  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    select: {
      invoiceRef: true,
      accountId: true,
      contactId: true,
      currency: true,
      issueDate: true,
      subtotal: true,
      taxAmount: true,
    },
  });

  const accounts = await prisma.ledgerAccount.findMany({
    where: { organizationId: org.id, isActive: true },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, type: true },
  });

  const determinable: DeterminableAccount[] = accounts.map((a) => ({
    id: a.id,
    code: a.code,
    name: a.name,
    type: a.type as LedgerAccountType,
  }));
  const { resolved } = resolvePostingAccounts(determinable);

  const tax = Number(invoice.taxAmount);
  const needed: string[] = ["receivables", "salesRevenue"];
  if (tax > 0) needed.push("taxPayable");
  const missing = needed.filter((role) => !resolved[role as keyof typeof resolved]);
  if (missing.length > 0) {
    return { posted: false, reason: "unresolved-accounts", detail: missing.join(", ") };
  }

  const lines = buildInvoicePostingLines(
    {
      subtotal: Number(invoice.subtotal),
      taxAmount: tax,
      customerAccountId: invoice.accountId,
      contactId: invoice.contactId,
    },
    {
      receivablesAccountId: resolved.receivables!.id!,
      revenueAccountId: resolved.salesRevenue!.id!,
      taxPayableAccountId: resolved.taxPayable?.id,
    },
  );

  const check = validateJournalEntry(lines);
  if (!check.ok) {
    // A balancing failure here is a programming error, not user input — surface loudly.
    throw new Error(`Invoice ${invoice.invoiceRef} posting is unbalanced: ${check.errors.join("; ")}`);
  }

  const entry = await prisma.journalEntry.create({
    data: {
      organizationId: org.id,
      entryRef: `JE-${invoice.invoiceRef}`,
      entryDate: invoice.issueDate,
      periodKey: periodKeyOf(invoice.issueDate),
      status: "posted",
      source: "invoice",
      sourceType: "Invoice",
      sourceId: invoiceId,
      currency: invoice.currency,
      postedAt: new Date(),
      memo: `Customer invoice ${invoice.invoiceRef}`,
      lines: {
        create: lines.map((l, i) => ({
          accountId: l.accountId,
          debit: l.debit ?? 0,
          credit: l.credit ?? 0,
          currency: invoice.currency,
          description: l.description,
          customerAccountId: l.customerAccountId ?? null,
          contactId: l.contactId ?? null,
          sortOrder: i,
        })),
      },
    },
    select: { id: true, entryRef: true },
  });

  return { posted: true, journalEntryId: entry.id, entryRef: entry.entryRef };
}
