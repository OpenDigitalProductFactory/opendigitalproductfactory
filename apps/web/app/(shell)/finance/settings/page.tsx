// apps/web/app/(shell)/finance/settings/page.tsx
import { getFinancialSetupStatus } from "@/lib/actions/financial-setup";
import { getDefaultDunningSequence } from "@/lib/actions/dunning";
import { getOrgSettings } from "@/lib/actions/currency";
import { getFinancialProfile } from "@dpf/finance-templates";
import Link from "next/link";

export default async function FinancialSettingsPage() {
  const [setupStatus, orgSettings, dunningSequence] = await Promise.all([
    getFinancialSetupStatus(),
    getOrgSettings(),
    getDefaultDunningSequence(),
  ]);

  // Derive profile-specific values. If profile isn't applied we show defaults.
  // We use baseCurrency as a proxy signal — any profile that was applied set it.
  // We can't look up the profile by slug because we don't store which slug was
  // applied, so we fall back to the professional_services profile defaults when
  // configured but no slug is known, or to bare defaults when not configured.
  const profile = setupStatus.isConfigured
    ? getFinancialProfile("professional_services") // sensible cross-profile defaults
    : null;

  const paymentTerms = profile?.defaultPaymentTerms ?? "Net 30";
  const vatRegistered = profile?.vatRegistered ?? false;
  const recurringEnabled = profile?.recurringBillingEnabled ?? false;
  const purchaseOrdersEnabled = profile?.purchaseOrdersEnabled ?? false;
  const invoiceTemplateStyle = profile?.invoiceTemplateStyle ?? "professional";

  const dunningStepCount = dunningSequence?.steps.length ?? 0;
  const dunningEnabled = setupStatus.dunningActive && dunningStepCount > 0;

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-2">
        <Link
          href="/finance"
          className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
        >
          Finance
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">Settings</span>
      </div>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Financial Settings</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          Overview of your financial configuration.
        </p>
      </div>

      {/* Settings cards grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">

        {/* 1. Applied Profile */}
        <div className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-2">
            Applied Profile
          </p>
          {setupStatus.isConfigured ? (
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-[var(--dpf-text)]">
                Profile Applied
              </span>
              <span
                className="text-[9px] px-2 py-0.5 rounded-full font-medium"
                style={{ color: "#4ade80", backgroundColor: "#4ade8020" }}
              >
                Configured
              </span>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-[var(--dpf-text)]">
                No profile applied
              </span>
              <div className="flex items-center gap-2">
                <span
                  className="text-[9px] px-2 py-0.5 rounded-full font-medium"
                  style={{ color: "#fbbf24", backgroundColor: "#fbbf2420" }}
                >
                  Not configured
                </span>
                <Link
                  href="/finance/settings"
                  className="text-[10px] text-[var(--dpf-accent)] hover:underline"
                >
                  Run Setup →
                </Link>
              </div>
            </div>
          )}
          <p className="text-[10px] text-[var(--dpf-muted)] mt-1">
            Business archetype determines default invoice, VAT, and dunning settings.
          </p>
        </div>

        {/* 2. Base Currency */}
        <div className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-2">
            Base Currency
          </p>
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-[var(--dpf-text)]">
              {orgSettings.baseCurrency}
            </span>
            <Link
              href="/finance/settings/currency"
              className="text-[10px] text-[var(--dpf-accent)] hover:underline"
            >
              Change →
            </Link>
          </div>
          <p className="text-[10px] text-[var(--dpf-muted)] mt-1">
            All amounts are displayed in this currency.
          </p>
        </div>

        {/* 3. Payment Terms */}
        <div className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-2">
            Payment Terms
          </p>
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-[var(--dpf-text)]">
              {paymentTerms}
            </span>
          </div>
          <p className="text-[10px] text-[var(--dpf-muted)] mt-1">
            Default terms applied to new invoices.
          </p>
        </div>

        {/* 4. VAT Status */}
        <div className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-2">
            VAT Status
          </p>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-[var(--dpf-text)]">
              {vatRegistered ? "VAT Registered" : "Not Registered"}
            </span>
            <span
              className="text-[9px] px-2 py-0.5 rounded-full font-medium"
              style={
                vatRegistered
                  ? { color: "#4ade80", backgroundColor: "#4ade8020" }
                  : { color: "#8888a0", backgroundColor: "#8888a020" }
              }
            >
              {vatRegistered ? "registered" : "not registered"}
            </span>
          </div>
          <p className="text-[10px] text-[var(--dpf-muted)] mt-1">
            VAT is applied to invoices when registration is active.
          </p>
        </div>

        {/* 5. Dunning */}
        <div className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-2">
            Dunning
          </p>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-[var(--dpf-text)]">
                {dunningEnabled ? "Enabled" : "Disabled"}
              </span>
              <span
                className="text-[9px] px-2 py-0.5 rounded-full font-medium"
                style={
                  dunningEnabled
                    ? { color: "#4ade80", backgroundColor: "#4ade8020" }
                    : { color: "#8888a0", backgroundColor: "#8888a020" }
                }
              >
                {dunningEnabled ? `${dunningStepCount} step${dunningStepCount !== 1 ? "s" : ""}` : "off"}
              </span>
            </div>
            <Link
              href="/finance/settings/dunning"
              className="text-[10px] text-[var(--dpf-accent)] hover:underline"
            >
              Configure →
            </Link>
          </div>
          <p className="text-[10px] text-[var(--dpf-muted)] mt-1">
            Automated payment reminders sent to overdue accounts.
          </p>
        </div>

        {/* 6. Recurring Billing */}
        <div className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-2">
            Recurring Billing
          </p>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-[var(--dpf-text)]">
              {recurringEnabled ? "Enabled" : "Disabled"}
            </span>
            <span
              className="text-[9px] px-2 py-0.5 rounded-full font-medium"
              style={
                recurringEnabled
                  ? { color: "#4ade80", backgroundColor: "#4ade8020" }
                  : { color: "#8888a0", backgroundColor: "#8888a020" }
              }
            >
              {recurringEnabled ? "enabled" : "disabled"}
            </span>
          </div>
          <p className="text-[10px] text-[var(--dpf-muted)] mt-1">
            Automatic invoice generation for subscriptions and retainers.
          </p>
        </div>

        {/* 7. Purchase Orders */}
        <div className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-2">
            Purchase Orders
          </p>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-[var(--dpf-text)]">
              {purchaseOrdersEnabled ? "Enabled" : "Disabled"}
            </span>
            <span
              className="text-[9px] px-2 py-0.5 rounded-full font-medium"
              style={
                purchaseOrdersEnabled
                  ? { color: "#4ade80", backgroundColor: "#4ade8020" }
                  : { color: "#8888a0", backgroundColor: "#8888a020" }
              }
            >
              {purchaseOrdersEnabled ? "enabled" : "disabled"}
            </span>
          </div>
          <p className="text-[10px] text-[var(--dpf-muted)] mt-1">
            Formal PO workflow for procurement approvals.
          </p>
        </div>

        {/* 8. Invoice Template */}
        <div className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-2">
            Invoice Template
          </p>
          <div className="flex items-center justify-between">
            <span
              className="text-sm font-bold capitalize"
              style={{ color: "#a78bfa" }}
            >
              {invoiceTemplateStyle}
            </span>
          </div>
          <p className="text-[10px] text-[var(--dpf-muted)] mt-1">
            Visual style applied to generated invoices.
          </p>
        </div>

      </div>

      {/* Footer action */}
      <div className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-[var(--dpf-text)]">
              Re-run Financial Setup
            </p>
            <p className="text-xs text-[var(--dpf-muted)] mt-0.5">
              Apply a different business archetype profile to reconfigure your defaults.
            </p>
          </div>
          <Link
            href="/finance/settings"
            className="px-3 py-1.5 text-xs font-medium rounded border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] hover:border-[var(--dpf-text)] transition-colors shrink-0"
          >
            Setup Wizard →
          </Link>
        </div>
      </div>
    </div>
  );
}
