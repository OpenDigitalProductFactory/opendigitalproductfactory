import { prisma } from "@dpf/db";
import { getFinancialSetupStatus } from "@/lib/actions/financial-setup";
import { getOrgSettings } from "@/lib/actions/currency";
import { FinanceSummaryCard } from "@/components/finance/FinanceSummaryCard";
import { FinanceTabNav } from "@/components/finance/FinanceTabNav";

export default async function FinanceConfigurationPage() {
  const [setupStatus, orgSettings, bankAccountCount, bankRuleCount, taxProfile, taxRegistrationCount] = await Promise.all([
    getFinancialSetupStatus(),
    getOrgSettings(),
    prisma.bankAccount.count(),
    prisma.bankRule.count(),
    prisma.organizationTaxProfile.findFirst(),
    prisma.taxRegistration.count(),
  ]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Finance</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          Keep banking, currency, reminders, and setup choices aligned with how the business operates.
        </p>
      </div>

      <FinanceTabNav />

      <div className="grid gap-4 lg:grid-cols-2">
        <FinanceSummaryCard
          title="Financial settings"
          description="Review applied setup, payment defaults, VAT posture, and profile assumptions."
          href="/finance/settings"
          accentColor="var(--dpf-accent)"
          metrics={[
            { label: "Configured", value: setupStatus.isConfigured ? "Yes" : "No" },
            { label: "Base currency", value: orgSettings.baseCurrency },
          ]}
        />
        <FinanceSummaryCard
          title="Banking"
          description="Manage connected accounts and keep reconciliation surfaces healthy."
          href="/finance/banking"
          accentColor="var(--dpf-info)"
          metrics={[
            { label: "Bank accounts", value: `${bankAccountCount}` },
            { label: "Rules", value: `${bankRuleCount}` },
          ]}
        />
        <FinanceSummaryCard
          title="Currency"
          description="Adjust the base currency when the finance operating model changes."
          href="/finance/settings/currency"
          accentColor="var(--dpf-success)"
          metrics={[
            { label: "Current", value: orgSettings.baseCurrency },
            { label: "Rates", value: "Org settings" },
          ]}
        />
        <FinanceSummaryCard
          title="Dunning"
          description="Control reminder behavior for overdue receivables and follow-up workflows."
          href="/finance/settings/dunning"
          accentColor="var(--dpf-warning)"
          metrics={[
            { label: "Active", value: setupStatus.dunningActive ? "Yes" : "No" },
            { label: "Setup", value: setupStatus.isConfigured ? "Applied" : "Needed" },
          ]}
        />
        <FinanceSummaryCard
          title="Tax remittance"
          description="Set tax posture, authority registrations, and the remittance-readiness workspace."
          href="/finance/settings/tax"
          accentColor="var(--dpf-warning)"
          metrics={[
            { label: "Setup", value: taxProfile?.setupStatus ?? "Draft" },
            { label: "Registrations", value: `${taxRegistrationCount}` },
          ]}
        />
      </div>
    </div>
  );
}
