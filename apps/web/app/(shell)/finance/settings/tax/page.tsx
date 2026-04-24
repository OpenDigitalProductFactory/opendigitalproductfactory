import Link from "next/link";
import { FinanceTabNav } from "@/components/finance/FinanceTabNav";
import { TaxRemittanceSettingsPanel } from "@/components/finance/TaxRemittanceSettingsPanel";
import { getTaxRemittanceWorkspace } from "@/lib/actions/tax-remittance";

export default async function TaxRemittanceSettingsPage() {
  const workspace = await getTaxRemittanceWorkspace();

  return (
    <div>
      <div className="mb-2">
        <Link
          href="/finance"
          className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
        >
          Finance
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <Link
          href="/finance/settings"
          className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
        >
          Settings
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">Tax Remittance</span>
      </div>

      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Tax Remittance</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          Track tax setup posture, jurisdiction registrations, and the first filing-readiness surfaces for the finance coworker.
        </p>
      </div>

      <FinanceTabNav />

      <div className="mb-6 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
          Workspace Context
        </p>
        <p className="mt-1 text-sm text-[var(--dpf-text)]">{workspace.organization.name}</p>
        <p className="mt-1 text-xs text-[var(--dpf-muted)]">
          This surface supports both already-configured businesses and first-time setup without assuming either posture by default.
        </p>
      </div>

      <TaxRemittanceSettingsPanel workspace={workspace} />
    </div>
  );
}
