// apps/web/app/(shell)/finance/page.tsx
import { prisma } from "@dpf/db";
import Link from "next/link";
import { cookies } from "next/headers";
import { OwnerFirstSummaryBand } from "@/components/owner-first/OwnerFirstSummary";
import { OwnerFirstDisclosure } from "@/components/owner-first/OwnerFirstDisclosure";
import { loadOwnerFirstContext } from "@/lib/owner-first/context";
import { buildFinanceOwnerSummary } from "@/lib/owner-first/domain-summary";
import { isSimpleNavMode, NAV_MODE_COOKIE, resolveNavModeFromCookie } from "@/lib/navigation/nav-mode";
import { getFinancialSetupStatus } from "@/lib/actions/financial-setup";
import { getOrgSettings } from "@/lib/actions/currency";
import { getCurrencySymbol } from "@/lib/currency-symbol";
import { AccountantWorkLanePanel } from "@/components/finance/AccountantWorkLanePanel";
import { getBookkeeperAccountantWorkLane } from "@/lib/finance/accountant-work-lane";
import { FinanceSummaryCard } from "@/components/finance/FinanceSummaryCard";
import { FinanceTabNav } from "@/components/finance/FinanceTabNav";
import { OwnerFirstFinanceView, type MoneyJobMetric } from "@/components/finance/OwnerFirstFinanceView";
import { resolveFinanceSurface, type FinanceMetricKey } from "@/lib/finance/finance-surface";
import { loadBurnRunway } from "@/lib/finance/burn-runway";
import { StatCard } from "@/components/ui/report-kit";
import { RecentInvoicesTable, type RecentInvoiceRow } from "./RecentInvoicesTable";

export default async function FinancePage() {
  const now = new Date();
  const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const in30Days = new Date(now);
  in30Days.setDate(in30Days.getDate() + 30);

  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const accountantLane = await getBookkeeperAccountantWorkLane();

  const [
    totalOutstanding,
    overdueInvoices,
    paidThisMonth,
    recentInvoices,
    moneyYouOwe,
    bankAccounts,
    expectedInflows,
    expectedOutflows,
    activeRecurringCount,
    overdueGt30,
    pendingExpenseCount,
    activeAssets,
    setupStatus,
    orgSettings,
    storefrontConfig,
  ] = await Promise.all([
    // Money owed to you — sum amountDue for active receivable statuses
    prisma.invoice.aggregate({
      where: {
        status: { in: ["sent", "viewed", "partially_paid", "overdue"] },
      },
      _sum: { amountDue: true },
      _count: true,
    }),

    // Overdue invoices — full list for count + oldest offender
    prisma.invoice.findMany({
      where: { status: "overdue" },
      orderBy: { dueDate: "asc" },
      select: {
        id: true,
        invoiceRef: true,
        dueDate: true,
        account: { select: { name: true } },
      },
    }),

    // Money in this month — paid invoices with paidAt >= first day of month
    prisma.invoice.aggregate({
      where: {
        status: "paid",
        paidAt: { gte: firstDayOfMonth },
      },
      _sum: { totalAmount: true },
      _count: true,
    }),

    // Recent invoices — last 10
    prisma.invoice.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        invoiceRef: true,
        status: true,
        totalAmount: true,
        account: { select: { name: true } },
      },
    }),

    // Money you owe — sum amountDue for approved/partially_paid bills (AP)
    prisma.bill.aggregate({
      where: {
        status: { in: ["approved", "partially_paid"] },
      },
      _sum: { amountDue: true },
      _count: true,
    }),

    // Cash position — active bank accounts
    prisma.bankAccount.findMany({
      where: { status: "active" },
      select: { name: true, currentBalance: true, currency: true },
    }),

    // 30-day cash flow forecast — expected inflows (invoices due in next 30 days)
    prisma.invoice.aggregate({
      where: {
        status: { in: ["sent", "viewed", "partially_paid", "overdue"] },
        dueDate: { gte: now, lte: in30Days },
      },
      _sum: { amountDue: true },
    }),

    // 30-day cash flow forecast — expected outflows (bills due in next 30 days)
    prisma.bill.aggregate({
      where: {
        status: { in: ["approved", "partially_paid"] },
        dueDate: { gte: now, lte: in30Days },
      },
      _sum: { amountDue: true },
    }),

    // Active recurring schedules count
    prisma.recurringSchedule.count({
      where: { status: "active" },
    }),

    // Overdue > 30 days — sum amountDue for invoices overdue more than 30 days
    prisma.invoice.aggregate({
      where: {
        status: { in: ["sent", "viewed", "partially_paid", "overdue"] },
        dueDate: { lt: thirtyDaysAgo },
      },
      _sum: { amountDue: true },
    }),

    // Pending expense claims
    prisma.expenseClaim.count({
      where: { status: "submitted" },
    }),

    // Active fixed assets — sum currentBookValue and count by category
    prisma.fixedAsset.findMany({
      where: { status: "active" },
      select: { currentBookValue: true, category: true },
    }),

    // Financial setup status — for setup prompt banner
    getFinancialSetupStatus(),

    // Org settings — for base currency
    getOrgSettings(),

    // Storefront archetype — category drives the owner-first (food-hospitality)
    // surface; archetypeId narrows it to the subtype (restaurant/catering/bakery).
    prisma.storefrontConfig.findFirst({
      select: { archetype: { select: { category: true, archetypeId: true } } },
    }),
  ]);

  // BI-090221E7: existence counts so "nothing recorded" is never rendered as a
  // healthy $0.00 — an empty book is unknown, not zero. Plus burn/revenue/runway
  // with an explicit unknown state.
  const [totalInvoiceCount, totalBillCount, burnRunway] = await Promise.all([
    prisma.invoice.count(),
    prisma.bill.count(),
    loadBurnRunway(),
  ]);
  const hasAnyInvoices = totalInvoiceCount > 0;
  const hasAnyBills = totalBillCount > 0;

  const financeSurface = resolveFinanceSurface(
    storefrontConfig?.archetype.category,
    storefrontConfig?.archetype.archetypeId,
  );

  const sym = getCurrencySymbol(orgSettings.baseCurrency);

  const owedAmount = Number(totalOutstanding._sum.amountDue ?? 0);
  const owedCount = totalOutstanding._count;
  const paidAmount = Number(paidThisMonth._sum.totalAmount ?? 0);
  const paidCount = paidThisMonth._count;
  const overdueCount = overdueInvoices.length;
  const oldestOverdue = overdueInvoices[0];
  const moneyOweAmount = Number(moneyYouOwe._sum.amountDue ?? 0);
  const moneyOweCount = moneyYouOwe._count;
  const overdueGt30Amount = Number(overdueGt30._sum.amountDue ?? 0);

  // Cash position
  const totalCash = bankAccounts.reduce(
    (sum, a) => sum + Number(a.currentBalance),
    0,
  );
  const inflowsIn30 = Number(expectedInflows._sum.amountDue ?? 0);
  const outflowsIn30 = Number(expectedOutflows._sum.amountDue ?? 0);
  const forecastBalance = totalCash + inflowsIn30 - outflowsIn30;

  // Asset register
  const totalAssetValue = activeAssets.reduce(
    (sum, a) => sum + Number(a.currentBookValue),
    0,
  );
  const assetCategoryCount = new Set(activeAssets.map((a) => a.category)).size;

  const formatMoney = (amount: number) =>
    amount.toLocaleString("en-GB", { minimumFractionDigits: 2 });

  const recentInvoiceRows: RecentInvoiceRow[] = recentInvoices.map((inv) => ({
    id: inv.id,
    invoiceRef: inv.invoiceRef,
    accountName: inv.account.name,
    status: inv.status,
    amount: Number(inv.totalAmount),
  }));

  // ─── Owner-first surface (food-hospitality) ─────────────────────────────────
  // Deeper, finance-specific owner-first view (BI-3326DA86): lead with the
  // restaurant's real money jobs — the same live figures re-framed as "what
  // needs attention today" — and push every accounting internal into the
  // collapsed advanced region. Supersedes the generic owner-first summary band
  // (BI-3BCAF95F) for food-hospitality, so it returns before that is built.
  if (financeSurface.mode === "owner-first") {
    const metricCopy = financeSurface.metricCopy;
    const moneyJobMetrics: Partial<Record<FinanceMetricKey, MoneyJobMetric>> = {
      "outstanding-receivables": {
        value: `${sym}${formatMoney(owedAmount)}`,
        hint: `${owedCount} ${owedCount === 1
          ? (metricCopy?.outstandingSingular ?? "invoice")
          : (metricCopy?.outstandingPlural ?? "invoices")} outstanding`,
        intent: owedAmount > 0 ? "warning" : "neutral",
      },
      "money-in-month": {
        value: `${sym}${formatMoney(paidAmount)}`,
        hint: metricCopy
          ? `${paidCount} ${paidCount === 1 ? metricCopy.receivedSingular : metricCopy.receivedPlural} received this month`
          : `${paidCount} invoice${paidCount !== 1 ? "s" : ""} paid this month`,
        intent: paidAmount > 0 ? "success" : "neutral",
      },
      "overdue-count": {
        value: `${overdueCount}`,
        hint:
          overdueCount > 0 && oldestOverdue
            ? `oldest: ${oldestOverdue.account.name}`
            : hasAnyInvoices
              ? "all up to date"
              : (metricCopy?.emptyOverdue ?? "no invoices recorded yet"),
        intent: overdueCount > 0 ? "danger" : hasAnyInvoices ? "success" : "neutral",
      },
      "supplier-bills-due": {
        value: `${sym}${formatMoney(moneyOweAmount)}`,
        hint: `${moneyOweCount} bill${moneyOweCount !== 1 ? "s" : ""} awaiting payment`,
        intent: moneyOweAmount > 0 ? "warning" : "success",
      },
      "cash-position": {
        value: bankAccounts.length === 0 ? "No accounts" : `${sym}${formatMoney(totalCash)}`,
        hint:
          bankAccounts.length === 0
            ? "add a bank account to reconcile payouts"
            : `across ${bankAccounts.length} account${bankAccounts.length !== 1 ? "s" : ""}`,
        intent: bankAccounts.length === 0 ? "neutral" : totalCash >= 0 ? "success" : "danger",
      },
    };

    return (
      <div>
        {!setupStatus.isConfigured && <SetupBanner />}

        <FinanceTabNav labels={financeSurface.navigationLabels} />

        <OwnerFirstFinanceView
          surface={financeSurface}
          metrics={moneyJobMetrics}
          advancedChildren={<AccountantWorkLanePanel lane={accountantLane} />}
        />

        {/* Recent invoices — owner-relevant, kept below the money jobs */}
        <section>
          <h2 className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-3">
            {financeSurface.recentRecordsLabel}
          </h2>
          {recentInvoices.length === 0 ? (
            <p className="text-sm text-[var(--dpf-muted)]">
              {financeSurface.recentRecordsEmpty}
            </p>
          ) : (
            <RecentInvoicesTable
              rows={recentInvoiceRows}
              currencySymbol={sym}
              accountHeader={metricCopy?.recentAccountHeader}
              emptyLabel={metricCopy?.recentEmpty}
            />
          )}
        </section>
      </div>
    );
  }

  // Owner-first summary for every other archetype (BI-3BCAF95F): open with what
  // must be paid, collected, or approved today, then demote the accountant lanes
  // and AR/AP/reporting taxonomy behind progressive disclosure.
  const simple = isSimpleNavMode(
    resolveNavModeFromCookie((await cookies()).get(NAV_MODE_COOKIE)?.value),
  );
  const { vocab } = await loadOwnerFirstContext();
  const ownerSummary = buildFinanceOwnerSummary(
    {
      billsDue: moneyOweCount,
      overdueInvoices: overdueCount,
      pendingExpenses: pendingExpenseCount,
      oldestOverdueName: oldestOverdue?.account.name ?? null,
      currencySymbol: sym,
      moneyOwedToYou: owedAmount,
    },
    vocab,
  );

  return (
    <div>
      {/* Setup prompt banner */}
      {!setupStatus.isConfigured && <SetupBanner />}

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--dpf-text)]">Finance</h1>
          <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
            Run cash, receivables, payables, and close work from one place.
          </p>
        </div>
        <Link
          href="/finance/invoices/new"
          className="px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity"
        >
          New Invoice
        </Link>
      </div>

      <FinanceTabNav />

      {/* Owner-first: money that needs paying, collecting, or approving today. */}
      <OwnerFirstSummaryBand summary={ownerSummary} density={simple ? "simple" : "full"} />

      {/* The finance workspace — lanes, at-a-glance money, the full taxonomy, and
          recent invoices — is the professional detail behind the daily money
          decisions. Simple mode drops it to reduce body content (BI-3BCAF95F). */}
      {!simple && (
        <>
      <OwnerFirstDisclosure summary="Finance lanes" hint="Revenue, Spend, Close, Configuration">
      <div className="grid gap-4 lg:grid-cols-2 mb-8">
        <FinanceSummaryCard
          title="Revenue"
          description="Track invoices, outstanding receivables, and inbound payments."
          href="/finance/revenue"
          accentColor="var(--dpf-accent)"
          metrics={[
            { label: "Outstanding", value: `${sym}${formatMoney(owedAmount)}` },
            { label: "Paid this month", value: `${sym}${formatMoney(paidAmount)}` },
          ]}
        />
        <FinanceSummaryCard
          title="Spend"
          description="Handle bills, suppliers, expenses, and outgoing commitments."
          href="/finance/spend"
          accentColor="var(--dpf-warning)"
          metrics={[
            { label: "Bills due", value: `${moneyOweCount}` },
            { label: "Pending claims", value: `${pendingExpenseCount}` },
          ]}
        />
        <FinanceSummaryCard
          title="Close"
          description="Jump into recurring work, reports, assets, and period-end checks."
          href="/finance/close"
          accentColor="var(--dpf-info)"
          metrics={[
            { label: "Recurring", value: `${activeRecurringCount}` },
            { label: "Assets", value: `${activeAssets.length}` },
          ]}
        />
        <FinanceSummaryCard
          title="Configuration"
          description="Keep banking, base currency, reminders, and setup aligned."
          href="/finance/configuration"
          accentColor="var(--dpf-success)"
          metrics={[
            { label: "Configured", value: setupStatus.isConfigured ? "Yes" : "No" },
            { label: "Bank accounts", value: `${bankAccounts.length}` },
          ]}
        />
      </div>

      <AccountantWorkLanePanel lane={accountantLane} />
      </OwnerFirstDisclosure>

      {/* Row 1: Cash Position + 30-day Forecast + Outstanding + Overdue */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        {bankAccounts.length === 0 ? (
          <StatCard
            label="Cash Position"
            value="No accounts"
            intent="neutral"
            hint={
              <Link href="/finance/banking" className="text-[var(--dpf-accent)] hover:underline">
                Add one →
              </Link>
            }
          />
        ) : (
          <StatCard
            label="Cash Position"
            value={`${sym}${formatMoney(totalCash)}`}
            intent={totalCash >= 0 ? "success" : "danger"}
            hint={`across ${bankAccounts.length} account${bankAccounts.length !== 1 ? "s" : ""}`}
          />
        )}
        <StatCard
          label="30-Day Forecast"
          value={`${sym}${formatMoney(forecastBalance)}`}
          intent={forecastBalance >= totalCash ? "success" : "danger"}
          hint={`+${sym}${formatMoney(inflowsIn30)} in · -${sym}${formatMoney(outflowsIn30)} out`}
        />
        <StatCard
          label="Money Owed To You"
          value={`${sym}${formatMoney(owedAmount)}`}
          hint={`${owedCount} invoice${owedCount !== 1 ? "s" : ""} outstanding`}
        />
        <StatCard
          label="Overdue"
          value={overdueCount}
          intent={overdueCount > 0 ? "danger" : hasAnyInvoices ? "success" : "neutral"}
          hint={
            overdueCount > 0 && oldestOverdue ? (
              <>Oldest: <span className="text-[var(--dpf-text)]">{oldestOverdue.account.name}</span></>
            ) : hasAnyInvoices ? (
              "All up to date"
            ) : (
              "No invoices recorded yet"
            )
          }
        />
      </div>

      {/* Burn & runway (BI-090221E7): explicit unknown state — an empty book is
          not a healthy $0.00, and pre-revenue with real burn is said plainly. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4" data-testid="finance-burn-runway">
        <StatCard
          label="Monthly Burn"
          value={
            burnRunway.monthlyBurn === null
              ? "Unknown"
              : `${sym}${formatMoney(burnRunway.monthlyBurn)}`
          }
          intent={burnRunway.monthlyBurn === null ? "neutral" : "accent"}
          hint={
            burnRunway.burnBasis === "unknown" ? (
              <Link href="/finance/bills/new" className="text-[var(--dpf-accent)] hover:underline">
                Record spend to measure →
              </Link>
            ) : burnRunway.burnBasis === "committed-only" ? (
              "committed subscriptions only — record paid bills for real burn"
            ) : (
              "trailing 90-day average incl. commitments"
            )
          }
        />
        <StatCard
          label="Monthly Revenue"
          value={
            burnRunway.monthlyRevenue === null
              ? "None recorded"
              : `${sym}${formatMoney(burnRunway.monthlyRevenue)}`
          }
          intent={burnRunway.monthlyRevenue === null ? "neutral" : "success"}
          hint={
            burnRunway.monthlyRevenue === null
              ? "no paid invoices in the last 90 days"
              : "trailing 90-day average"
          }
        />
        <StatCard
          label="Runway"
          value={
            burnRunway.runwayState === "measured" && burnRunway.runwayMonths !== null
              ? `${burnRunway.runwayMonths.toFixed(1)} months`
              : burnRunway.runwayState === "cash-growing"
                ? "Cash growing"
                : "Unknown"
          }
          intent={
            burnRunway.runwayState === "measured"
              ? burnRunway.runwayMonths !== null && burnRunway.runwayMonths < 6
                ? "danger"
                : "success"
              : burnRunway.runwayState === "cash-growing"
                ? "success"
                : "neutral"
          }
          hint={
            burnRunway.runwayState === "unknown-burn"
              ? "needs measured burn"
              : burnRunway.runwayState === "unknown-cash"
                ? "needs a bank account balance"
                : burnRunway.runwayState === "cash-growing"
                  ? "revenue covers current burn"
                  : "cash ÷ net monthly burn"
          }
        />
        <StatCard
          label="Money Health"
          value={burnRunway.preRevenueWithBurn ? "Pre-revenue" : hasAnyInvoices || hasAnyBills ? "Tracking" : "Not started"}
          intent={burnRunway.preRevenueWithBurn ? "danger" : "neutral"}
          hint={
            burnRunway.preRevenueWithBurn
              ? "money is going out with no revenue recorded — watch runway"
              : burnRunway.gaps[0] ?? "books have activity in both directions"
          }
        />
      </div>

      {/* Row 2: Money In + Money You Owe + Active Recurring + Overdue >30 days */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Money In This Month"
          value={`${sym}${formatMoney(paidAmount)}`}
          hint={`${paidCount} invoice${paidCount !== 1 ? "s" : ""} paid`}
        />
        {hasAnyBills ? (
          <StatCard
            label="Money You Owe"
            value={`${sym}${formatMoney(moneyOweAmount)}`}
            intent={moneyOweAmount > 0 ? "danger" : "success"}
            hint={`${moneyOweCount} bill${moneyOweCount !== 1 ? "s" : ""} awaiting payment`}
          />
        ) : (
          <StatCard
            label="Money You Owe"
            value="Not recorded"
            intent="neutral"
            hint={
              <Link href="/finance/bills/new" className="text-[var(--dpf-accent)] hover:underline">
                Record supplier bills →
              </Link>
            }
          />
        )}
        <StatCard
          label="Active Recurring"
          value={activeRecurringCount}
          intent={activeRecurringCount > 0 ? "success" : "neutral"}
          hint={
            <Link href="/finance/recurring" className="hover:underline">
              schedule{activeRecurringCount !== 1 ? "s" : ""} running →
            </Link>
          }
        />
        <StatCard
          label="Overdue > 30 Days"
          value={`${sym}${formatMoney(overdueGt30Amount)}`}
          intent={overdueGt30Amount > 0 ? "danger" : "success"}
          hint={
            <Link href="/finance/reports/aged-debtors" className="hover:underline">
              view aged debtors →
            </Link>
          }
        />
      </div>

      {/* Row 3: People + Asset widgets */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Pending Expenses"
          value={pendingExpenseCount}
          intent={pendingExpenseCount > 0 ? "accent" : "success"}
          hint={
            <Link href="/finance/expense-claims?status=submitted" className="hover:underline">
              claim{pendingExpenseCount !== 1 ? "s" : ""} awaiting approval →
            </Link>
          }
        />
        <StatCard
          label="Total Asset Value"
          value={`${sym}${formatMoney(totalAssetValue)}`}
          intent={totalAssetValue > 0 ? "success" : "neutral"}
          hint={
            <>
              {activeAssets.length} asset{activeAssets.length !== 1 ? "s" : ""} across{" "}
              {assetCategoryCount} categor{assetCategoryCount !== 1 ? "ies" : "y"} ·{" "}
              <Link href="/finance/assets" className="hover:underline">
                view register →
              </Link>
            </>
          }
        />
      </div>

      {/* Navigation links — the AR/AP/procurement/reporting taxonomy. */}
      <OwnerFirstDisclosure
        summary="All finance areas"
        hint="AR, AP, procurement, banking, reports, and settings"
      >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {/* AR links */}
        <div className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-3">
            Accounts Receivable
          </p>
          <div className="flex flex-col gap-2">
            <Link href="/finance/invoices" className="text-xs text-[var(--dpf-accent)] hover:underline">
              Invoices →
            </Link>
            <Link href="/finance/payments" className="text-xs text-[var(--dpf-accent)] hover:underline">
              Payments →
            </Link>
            <Link href="/finance/recurring" className="text-xs text-[var(--dpf-accent)] hover:underline">
              Recurring Schedules →
            </Link>
          </div>
        </div>

        {/* AP links */}
        <div className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-3">
            Accounts Payable
          </p>
          <div className="flex flex-col gap-2">
            <Link href="/finance/suppliers" className="text-xs text-[var(--dpf-accent)] hover:underline">
              Suppliers →
            </Link>
            <Link href="/finance/bills" className="text-xs text-[var(--dpf-accent)] hover:underline">
              Bills →
            </Link>
          </div>
        </div>

        {/* Procurement */}
        <div className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-3">
            Procurement
          </p>
          <div className="flex flex-col gap-2">
            <Link href="/finance/purchase-orders" className="text-xs text-[var(--dpf-accent)] hover:underline">
              Purchase Orders →
            </Link>
            <Link href="/finance/payment-runs" className="text-xs text-[var(--dpf-accent)] hover:underline">
              Payment Runs →
            </Link>
          </div>
        </div>

        {/* Banking */}
        <div className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-3">
            Banking
          </p>
          <div className="flex flex-col gap-2">
            <Link href="/finance/banking" className="text-xs text-[var(--dpf-accent)] hover:underline">
              Bank Accounts →
            </Link>
            <Link href="/finance/banking/rules" className="text-xs text-[var(--dpf-accent)] hover:underline">
              Bank Rules →
            </Link>
          </div>
        </div>

        {/* Reports */}
        <div className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-3">
            Reports
          </p>
          <div className="flex flex-col gap-2">
            <Link href="/finance/reports" className="text-xs text-[var(--dpf-accent)] hover:underline">
              All Reports →
            </Link>
            <Link href="/finance/reports/profit-loss" className="text-xs text-[var(--dpf-accent)] hover:underline">
              Profit &amp; Loss →
            </Link>
            <Link href="/finance/reports/cash-flow" className="text-xs text-[var(--dpf-accent)] hover:underline">
              Cash Flow →
            </Link>
            <Link href="/finance/reports/vat-summary" className="text-xs text-[var(--dpf-accent)] hover:underline">
              VAT Summary →
            </Link>
            <Link href="/finance/reports/outstanding" className="text-xs text-[var(--dpf-accent)] hover:underline">
              Outstanding Invoices →
            </Link>
            <Link href="/finance/reports/aged-debtors" className="text-xs text-[var(--dpf-accent)] hover:underline">
              Aged Debtors →
            </Link>
            <Link href="/finance/reports/aged-creditors" className="text-xs text-[var(--dpf-accent)] hover:underline">
              Aged Creditors →
            </Link>
          </div>
        </div>

        {/* People */}
        <div className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-3">
            People
          </p>
          <div className="flex flex-col gap-2">
            <Link href="/finance/expense-claims" className="text-xs text-[var(--dpf-accent)] hover:underline">
              Expense Claims →
            </Link>
            <Link href="/finance/my-expenses" className="text-xs text-[var(--dpf-accent)] hover:underline">
              My Expenses →
            </Link>
          </div>
        </div>

        {/* Management */}
        <div className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-3">
            Management
          </p>
          <div className="flex flex-col gap-2">
            <Link href="/finance/assets" className="text-xs text-[var(--dpf-accent)] hover:underline">
              Asset Register →
            </Link>
            <Link href="/finance/assets/new" className="text-xs text-[var(--dpf-accent)] hover:underline">
              Register Asset →
            </Link>
            <Link href="/finance/settings/currency" className="text-xs text-[var(--dpf-accent)] hover:underline">
              Currency Settings →
            </Link>
          </div>
        </div>

        {/* Settings */}
        <div className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-3">
            Settings
          </p>
          <div className="flex flex-col gap-2">
            <Link href="/finance/settings" className="text-xs text-[var(--dpf-accent)] hover:underline">
              Financial Settings →
            </Link>
            <Link href="/finance/settings/currency" className="text-xs text-[var(--dpf-accent)] hover:underline">
              Currency Settings →
            </Link>
            <Link href="/finance/settings/dunning" className="text-xs text-[var(--dpf-accent)] hover:underline">
              Dunning Settings →
            </Link>
          </div>
        </div>
      </div>
      </OwnerFirstDisclosure>

      {/* Recent Invoices */}
      <section>
        <h2 className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-3">
          Recent Invoices
        </h2>

        {recentInvoices.length === 0 ? (
          <p className="text-sm text-[var(--dpf-muted)]">
            No invoices yet. Create your first invoice to get started.
          </p>
        ) : (
          <RecentInvoicesTable rows={recentInvoiceRows} currencySymbol={sym} />
        )}
      </section>
        </>
      )}
    </div>
  );
}

function SetupBanner() {
  return (
    <div className="mb-6 rounded-lg border border-[color-mix(in_srgb,var(--dpf-warning)_35%,var(--dpf-border))] bg-[color-mix(in_srgb,var(--dpf-warning)_10%,transparent)] p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-[var(--dpf-warning)]">Complete your financial setup</p>
          <p className="text-xs text-[var(--dpf-muted)] mt-0.5">
            Set up your finances based on your business type to get started with invoicing, expenses, and reporting.
          </p>
        </div>
        <Link
          href="/finance/settings/setup"
          className="px-3 py-1.5 text-xs font-medium rounded bg-[var(--dpf-warning)] text-[var(--dpf-bg)] hover:opacity-90 transition-opacity shrink-0"
        >
          Set Up Now
        </Link>
      </div>
    </div>
  );
}
