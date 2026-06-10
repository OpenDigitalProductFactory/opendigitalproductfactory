"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { upsertFundBudgetLine } from "@/lib/actions/civic-governance";

const inputClasses =
  "w-full rounded border border-[var(--dpf-border)] bg-transparent px-3 py-1.5 text-sm text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] focus:border-[var(--dpf-accent)] focus:outline-none";
const labelClasses = "block text-xs text-[var(--dpf-muted)] mb-1";

const FUND_LABELS: Record<string, string> = {
  general: "General Fund",
  "special-revenue": "Special Revenue",
  enterprise: "Enterprise Fund",
  "capital-projects": "Capital Projects",
  "debt-service": "Debt Service",
};

export type FundBudgetRow = {
  id: string;
  fiscalYear: number;
  fund: string;
  accountCode: string;
  accountName: string | null;
  budgetedAmount: number;
};

export function FundBudgetPanel({
  lines,
  fiscalYear,
  currency,
}: {
  lines: FundBudgetRow[];
  fiscalYear: number;
  currency: string;
}) {
  const router = useRouter();
  const [showAdd, setShowAdd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fmt = new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 });

  const byFund = new Map<string, FundBudgetRow[]>();
  for (const line of lines) {
    const list = byFund.get(line.fund) ?? [];
    list.push(line);
    byFund.set(line.fund, list);
  }

  async function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const result = await upsertFundBudgetLine({
      fiscalYear: Number(form.get("fiscalYear")),
      fund: form.get("fund") as string,
      accountCode: form.get("accountCode") as string,
      budgetedAmount: Number(form.get("budgetedAmount")),
      notes: (form.get("notes") as string) || undefined,
    });
    setBusy(false);
    if (!result.ok) setError(result.message);
    else {
      setShowAdd(false);
      router.refresh();
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="px-3 py-1.5 text-xs font-medium rounded bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity"
        >
          {showAdd ? "Close" : "Add Budget Line"}
        </button>
      </div>

      {showAdd && (
        <form
          onSubmit={handleAdd}
          className="grid gap-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 sm:grid-cols-2"
        >
          <div>
            <label className={labelClasses}>Fiscal year *</label>
            <input name="fiscalYear" type="number" defaultValue={fiscalYear} required className={inputClasses} />
          </div>
          <div>
            <label className={labelClasses}>Fund *</label>
            <select name="fund" required className={inputClasses}>
              {Object.entries(FUND_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClasses}>Account code *</label>
            <input name="accountCode" required className={inputClasses} placeholder="5020" />
          </div>
          <div>
            <label className={labelClasses}>Budgeted amount *</label>
            <input name="budgetedAmount" type="number" min="0" step="0.01" required className={inputClasses} />
          </div>
          <div className="sm:col-span-2 flex justify-end">
            <button
              type="submit"
              disabled={busy}
              className="px-3 py-1.5 text-xs font-medium rounded bg-[var(--dpf-accent)] text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      )}

      {error && <p className="text-xs text-[var(--dpf-error)]">{error}</p>}

      {Array.from(byFund.entries()).map(([fund, fundLines]) => {
        const total = fundLines.reduce((sum, l) => sum + l.budgetedAmount, 0);
        return (
          <section key={fund} className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
            <header className="flex items-center justify-between border-b border-[var(--dpf-border)] px-4 py-2">
              <h2 className="text-sm font-semibold text-[var(--dpf-text)]">{FUND_LABELS[fund] ?? fund}</h2>
              <span className="text-xs text-[var(--dpf-muted)]">Budgeted {fmt.format(total)}</span>
            </header>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--dpf-muted)]">
                  <th className="px-4 py-2 font-medium">Account</th>
                  <th className="px-4 py-2 font-medium text-right">Budget (FY{fiscalYear})</th>
                  <th className="px-4 py-2 font-medium text-right">Actual</th>
                </tr>
              </thead>
              <tbody>
                {fundLines.map((line) => (
                  <tr key={line.id} className="border-t border-[var(--dpf-border)]/50">
                    <td className="px-4 py-2 text-[var(--dpf-text)]">
                      <span className="font-mono text-xs text-[var(--dpf-muted)]">{line.accountCode}</span>{" "}
                      {line.accountName ?? ""}
                    </td>
                    <td className="px-4 py-2 text-right text-[var(--dpf-text)]">{fmt.format(line.budgetedAmount)}</td>
                    <td className="px-4 py-2 text-right text-[var(--dpf-muted)]">—</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}

      {lines.length === 0 && (
        <div className="rounded-lg border border-dashed border-[var(--dpf-border)] p-6 text-center text-sm text-[var(--dpf-muted)]">
          No budget lines for FY{fiscalYear}. Add appropriations per fund to start the
          budget-to-actual view; actuals populate as fund-tagged transactions land.
        </div>
      )}
    </div>
  );
}
