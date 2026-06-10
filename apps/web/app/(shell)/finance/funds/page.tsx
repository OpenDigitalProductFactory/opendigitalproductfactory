import { notFound } from "next/navigation";
import { prisma } from "@dpf/db";
import { getFinancialProfile, LEDGER_COA_FRAGMENTS } from "@dpf/finance-templates";
import { getOrgSettings } from "@/lib/actions/currency";
import { FundBudgetPanel, type FundBudgetRow } from "@/components/civic/FundBudgetPanel";

// Budget-to-actual fund view (BI-8D477188 Phase 3) — first consumer of
// FinancialProfile.ledgerModel. Renders only for fund-accounting profiles;
// commercial archetypes never see a Funds surface (civic spec §13.5).
export default async function FundsPage() {
  const orgSettings = await getOrgSettings();
  const profile = orgSettings.appliedProfileSlug
    ? getFinancialProfile(orgSettings.appliedProfileSlug)
    : null;

  if (profile?.ledgerModel !== "fund-accounting") notFound();

  const fiscalYear = new Date().getFullYear();
  const lines = await prisma.fundBudgetLine.findMany({
    where: { fiscalYear },
    orderBy: [{ fund: "asc" }, { accountCode: "asc" }],
  });

  // Resolve display names from the fund-accounting COA fragment.
  const accountNames = new Map(
    LEDGER_COA_FRAGMENTS["fund-accounting"].map((account) => [account.code, account.name]),
  );

  const rows: FundBudgetRow[] = lines.map((line) => ({
    id: line.id,
    fiscalYear: line.fiscalYear,
    fund: line.fund,
    accountCode: line.accountCode,
    accountName: accountNames.get(line.accountCode) ?? null,
    budgetedAmount: Number(line.budgetedAmount),
  }));

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Funds</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          Budget-to-actual by fund · FY{fiscalYear} · appropriations are the legal spending
          constraint
        </p>
      </div>
      <FundBudgetPanel
        lines={rows}
        fiscalYear={fiscalYear}
        currency={orgSettings.baseCurrency ?? "USD"}
      />
    </div>
  );
}
