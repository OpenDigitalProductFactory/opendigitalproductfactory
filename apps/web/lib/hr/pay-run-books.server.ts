// lib/hr/pay-run-books.server.ts — approve a pay run and record it paid
// (BI-3B8FA6D8). The journal shapes live in pay-run-books.ts.
//
// Approval and payment are a person's acts. The actor comes from the session
// and the automation persona is refused, so an agent driving a browser cannot
// approve payroll or claim money was sent. Each journal is posted once per run
// (keyed on sourceType + sourceId) and a locked period is refused.

import { prisma } from "@dpf/db";
import { resolvePostingAccounts } from "@/lib/finance/chart-of-accounts";
import { getOrgBaseCurrency } from "@/lib/org-locale/org-currency.server";
import { isPeriodLocked, periodKeyOf, type LedgerAccountType } from "@/lib/finance/ledger";
import { seedChartOfAccounts } from "@/lib/finance/ledger-service";
import { isPlatformAutomationPersona } from "@/lib/govern/automation-persona-identity";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";
import type { PayComponent } from "./payroll";
import { markPayslipDisbursed, type DisbursePayslipClient } from "./payroll-run";
import { approvalJournal, paymentJournal, type BooksLine, type PayrollAccountIds, type RunPayslip } from "./pay-run-books";

export interface PayRunActor {
  userId: string;
  email: string | null;
}

const lines = (v: unknown): PayComponent[] => (Array.isArray(v) ? (v as PayComponent[]) : []);

async function loadRun(payRunId: string) {
  return prisma.payRun.findUnique({
    where: { id: payRunId },
    select: {
      id: true, payRunRef: true, status: true, periodEnd: true, payDate: true,
      payslips: { select: { id: true, netPay: true, earnings: true, employeeDeductions: true, employerCosts: true } },
    },
  });
}

function toRunPayslips(slips: NonNullable<Awaited<ReturnType<typeof loadRun>>>["payslips"]): RunPayslip[] {
  return slips.map((s) => ({
    netPay: Number(s.netPay),
    earnings: lines(s.earnings),
    employeeDeductions: lines(s.employeeDeductions),
    employerCosts: lines(s.employerCosts),
  }));
}

/** The org's payroll accounts, laying down any missing base accounts first. */
async function payrollAccounts(): Promise<{ organizationId: string; ids: PayrollAccountIds } | { error: string }> {
  const org = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!org) return { error: "No organization exists to keep the books for." };
  // Create-if-missing: adds the payroll accounts to a chart seeded before they existed.
  await seedChartOfAccounts(org.id);
  const rows = await prisma.ledgerAccount.findMany({
    where: { organizationId: org.id, isActive: true },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, type: true },
  });
  const { resolved } = resolvePostingAccounts(rows.map((a) => ({ ...a, type: a.type as LedgerAccountType })));
  const need = ["wagesExpense", "payrollTaxExpense", "netPayPayable", "payrollTaxPayable", "payrollDeductionsPayable", "bank"] as const;
  const missing = need.filter((r) => !resolved[r]?.id);
  if (missing.length > 0) return { error: `The chart of accounts has no account for: ${missing.join(", ")}.` };
  const id = (r: (typeof need)[number]) => resolved[r]!.id!;
  return {
    organizationId: org.id,
    ids: {
      wagesExpense: id("wagesExpense"), payrollTaxExpense: id("payrollTaxExpense"), netPayPayable: id("netPayPayable"),
      payrollTaxPayable: id("payrollTaxPayable"), payrollDeductionsPayable: id("payrollDeductionsPayable"), bank: id("bank"),
    },
  };
}

async function lockedPeriods(): Promise<string[]> {
  const row = await prisma.platformConfig.findUnique({ where: { key: "finance.locked_periods" }, select: { value: true } });
  return (row?.value as string[] | null) ?? [];
}

function journalData(input: {
  organizationId: string; entryRef: string; entryDate: Date; currency: string;
  sourceType: string; sourceId: string; memo: string; lines: BooksLine[];
}) {
  return {
    organizationId: input.organizationId,
    entryRef: input.entryRef,
    entryDate: input.entryDate,
    periodKey: periodKeyOf(input.entryDate),
    status: "posted",
    source: "payroll",
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    currency: input.currency,
    postedAt: new Date(),
    memo: input.memo,
    lines: {
      create: input.lines.map((l, i) => ({
        accountId: l.accountId, debit: l.debit, credit: l.credit, currency: input.currency, description: l.description, sortOrder: i,
      })),
    },
  };
}

/** A person approves a draft run: it can no longer be recomputed, and its journal is posted. */
export async function approvePayRun(payRunId: string, actor: PayRunActor): Promise<ActionResult<{ journalEntryId: string }>> {
  if (isPlatformAutomationPersona(actor.email)) return err("A pay run must be approved by a person, not by an automated session.");
  const run = await loadRun(payRunId);
  if (!run) return err("That pay run no longer exists.");
  if (run.status !== "draft") return err("Only a draft pay run can be approved.");
  if (run.payslips.length === 0) return err("This pay run has no payslips to approve.");

  const accounts = await payrollAccounts();
  if ("error" in accounts) return err(accounts.error);
  const journal = approvalJournal(toRunPayslips(run.payslips), accounts.ids);
  if (!journal) return err("This pay run does not balance, so it cannot be posted. Recompute it before approving.");

  const entryDate = run.payDate ?? run.periodEnd;
  if (isPeriodLocked(periodKeyOf(entryDate), await lockedPeriods())) {
    return err("The books for that period are closed. Reopen the period or change the pay date first.");
  }
  const currency = await getOrgBaseCurrency();

  const entry = await prisma.$transaction(async (tx) => {
    // Re-read inside the transaction so two approvals cannot both post.
    const fresh = await tx.payRun.updateMany({ where: { id: run.id, status: "draft" }, data: { status: "approved" } });
    if (fresh.count !== 1) return null;
    return tx.journalEntry.create({
      data: journalData({
        organizationId: accounts.organizationId, entryRef: `JE-PAY-${run.payRunRef}`, entryDate, currency,
        sourceType: "PayRun", sourceId: run.id, memo: `Payroll ${run.payRunRef} approved by ${actor.userId}`, lines: journal,
      }),
      select: { id: true },
    });
  });
  if (!entry) return err("This pay run was approved by someone else a moment ago.");
  return ok({ journalEntryId: entry.id });
}

/** A person records that an approved run's net pay was sent from the bank. */
export async function recordPayRunPaid(
  payRunId: string,
  actor: PayRunActor,
  input: { bankReference: string; paidOn: Date },
): Promise<ActionResult<{ journalEntryId: string; payslips: number }>> {
  if (isPlatformAutomationPersona(actor.email)) return err("Payment must be recorded by a person, not by an automated session.");
  const bankReference = input.bankReference.trim();
  if (!bankReference) return err("Enter the bank's reference for the payment, so the record can be traced.");
  const run = await loadRun(payRunId);
  if (!run) return err("That pay run no longer exists.");
  if (run.status !== "approved") return err("Approve the pay run before recording it paid.");

  const accounts = await payrollAccounts();
  if ("error" in accounts) return err(accounts.error);
  const journal = paymentJournal(toRunPayslips(run.payslips), accounts.ids);
  if (!journal) return err("This pay run has no net pay to record.");
  if (isPeriodLocked(periodKeyOf(input.paidOn), await lockedPeriods())) {
    return err("The books for that period are closed. Reopen the period or pick the actual payment date.");
  }
  const currency = await getOrgBaseCurrency();

  const recordedAt = new Date();
  // One transaction, claimed by a conditional status change, so a retried or
  // concurrent submission cannot post a second payment journal, and payslips
  // are never marked paid without the journal that records the payment.
  const entry = await prisma.$transaction(async (tx) => {
    const claimed = await tx.payRun.updateMany({ where: { id: run.id, status: "approved" }, data: { status: "paid" } });
    if (claimed.count !== 1) return null;
    for (const slip of run.payslips) {
      // paidAt is the date the money left the bank; the attestation's own time
      // (recordedAt) and the person are kept on the journal below.
      await markPayslipDisbursed(tx as unknown as DisbursePayslipClient, slip.id, "paid", input.paidOn);
    }
    return tx.journalEntry.create({
      data: journalData({
        organizationId: accounts.organizationId, entryRef: `JE-PAYOUT-${run.payRunRef}`, entryDate: input.paidOn, currency,
        sourceType: "PayRunPayment", sourceId: run.id,
        memo: `Payroll ${run.payRunRef} paid on ${input.paidOn.toISOString().slice(0, 10)}, bank reference ${bankReference}; attested by ${actor.userId} at ${recordedAt.toISOString()}`,
        lines: journal,
      }),
      select: { id: true },
    });
  });
  if (!entry) return err("This pay run was recorded as paid a moment ago.");
  return ok({ journalEntryId: entry.id, payslips: run.payslips.length });
}
