// apps/web/app/(shell)/finance/banking/rules/page.tsx
import { listBankRules } from "@/lib/actions/banking";
import Link from "next/link";
import { BankRulesManager } from "@/components/finance/BankRulesManager";

export default async function BankRulesPage() {
  const rules = await listBankRules();

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
        <Link
          href="/finance/banking"
          className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
        >
          Banking
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">Rules</span>
      </div>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Bank Rules</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          Automatically categorise transactions when importing statements.
        </p>
      </div>

      <BankRulesManager initialRules={rules} />
    </div>
  );
}
