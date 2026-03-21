// apps/web/app/(shell)/finance/settings/currency/page.tsx
import { getOrgSettings } from "@/lib/actions/currency";
import { prisma } from "@dpf/db";
import Link from "next/link";
import { BaseCurrencySelector } from "@/components/finance/BaseCurrencySelector";
import { FetchRatesButton } from "@/components/finance/FetchRatesButton";
import { ManualRateForm } from "@/components/finance/ManualRateForm";

const SUPPORTED_CURRENCIES = [
  "GBP", "USD", "EUR", "CAD", "AUD", "NZD", "CHF", "SEK", "NOK", "DKK",
  "JPY", "SGD", "HKD", "ZAR", "AED", "INR", "BRL", "MXN", "PLN", "CZK",
];

export default async function CurrencySettingsPage() {
  const [orgSettings, recentRates] = await Promise.all([
    getOrgSettings(),
    // Fetch most recent rate per base/target pair
    prisma.exchangeRate.findMany({
      orderBy: { fetchedAt: "desc" },
      take: 50,
    }),
  ]);

  // Deduplicate rates — keep most recent per pair
  const seen = new Set<string>();
  const deduplicatedRates = recentRates.filter((r) => {
    const key = `${r.baseCurrency}/${r.targetCurrency}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort: GBP base first, then EUR, then USD
  const priorityOrder = ["GBP", "EUR", "USD"];
  const sortedRates = [...deduplicatedRates].sort((a, b) => {
    const ai = priorityOrder.indexOf(a.baseCurrency);
    const bi = priorityOrder.indexOf(b.baseCurrency);
    if (ai !== bi) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    return a.targetCurrency.localeCompare(b.targetCurrency);
  });

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-2">
        <Link href="/finance" className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">
          Finance
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <Link href="/finance/settings" className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">Settings</Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">Currency</span>
      </div>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Currency Settings</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          Configure your base currency and exchange rates.
        </p>
      </div>

      {/* Base currency */}
      <div className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] mb-6">
        <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-3">
          Base Currency
        </p>
        <div className="flex items-center gap-4">
          <div>
            <p className="text-xs text-[var(--dpf-muted)] mb-1">Current</p>
            <span
              className="text-lg font-bold px-3 py-1 rounded-lg border border-[var(--dpf-border)]"
              style={{ color: "#4ade80" }}
            >
              {orgSettings.baseCurrency}
            </span>
          </div>
          <div>
            <p className="text-xs text-[var(--dpf-muted)] mb-1">Change to</p>
            <BaseCurrencySelector
              currentCurrency={orgSettings.baseCurrency}
              currencies={SUPPORTED_CURRENCIES}
            />
          </div>
        </div>
      </div>

      {/* Exchange rates table */}
      <div className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] mb-6">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
            Exchange Rates
          </p>
          <FetchRatesButton />
        </div>

        {sortedRates.length === 0 ? (
          <div className="py-6 text-center">
            <p className="text-xs text-[var(--dpf-muted)] mb-2">No rates stored yet.</p>
            <p className="text-[10px] text-[var(--dpf-muted)]">
              Click &quot;Fetch Latest Rates&quot; to load ECB reference rates.
            </p>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--dpf-border)]">
                <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] pb-2 font-normal">
                  Pair
                </th>
                <th className="text-right text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] pb-2 font-normal">
                  Rate
                </th>
                <th className="text-right text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] pb-2 font-normal">
                  Last Fetched
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedRates.map((rate) => (
                <tr
                  key={`${rate.baseCurrency}/${rate.targetCurrency}`}
                  className="border-b border-[var(--dpf-border)] last:border-0"
                >
                  <td className="py-2.5">
                    <span className="font-mono text-[var(--dpf-text)]">
                      {rate.baseCurrency}
                    </span>
                    <span className="text-[var(--dpf-muted)] mx-1">→</span>
                    <span className="font-mono text-[var(--dpf-text)]">
                      {rate.targetCurrency}
                    </span>
                  </td>
                  <td className="py-2.5 text-right font-mono" style={{ color: "#38bdf8" }}>
                    {Number(rate.rate).toFixed(4)}
                  </td>
                  <td className="py-2.5 text-right text-[var(--dpf-muted)]">
                    {new Date(rate.fetchedAt).toLocaleDateString("en-GB")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p className="text-[10px] text-[var(--dpf-muted)] mt-4">
          Rates are sourced from ECB reference data. Override manually if your bank rate differs.
        </p>
      </div>

      {/* Manual rate override */}
      <div className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
        <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-3">
          Manual Rate Override
        </p>
        <p className="text-xs text-[var(--dpf-muted)] mb-4">
          Add or update a specific currency pair rate. This stores a new rate record.
        </p>
        <ManualRateForm currencies={SUPPORTED_CURRENCIES} />
      </div>
    </div>
  );
}
