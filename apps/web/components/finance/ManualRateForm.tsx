"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { storeExchangeRates } from "@/lib/actions/currency";

const inputClasses =
  "bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] text-[var(--dpf-text)] rounded px-3 py-2 text-sm focus:border-[var(--dpf-accent)] focus:outline-none placeholder:text-[var(--dpf-muted)]";
const labelClasses = "block text-xs text-[var(--dpf-muted)] mb-1";

interface Props {
  currencies: string[];
}

export function ManualRateForm({ currencies }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [baseCurrency, setBaseCurrency] = useState(currencies[0] ?? "GBP");
  const [targetCurrency, setTargetCurrency] = useState(currencies[1] ?? "USD");
  const [rate, setRate] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (baseCurrency === targetCurrency) {
      setError("Base and target currencies must differ");
      return;
    }
    setLoading(true);
    setSaved(false);
    setError(null);

    try {
      await storeExchangeRates([
        { base: baseCurrency, target: targetCurrency, rate: parseFloat(rate) },
      ]);
      setSaved(true);
      setRate("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save rate");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-4">
      {error && (
        <div className="w-full p-2 rounded border border-[var(--dpf-error)] bg-[color-mix(in_srgb,var(--dpf-error)_12%,transparent)] text-[10px] text-[var(--dpf-error)]">
          {error}
        </div>
      )}

      <div>
        <label className={labelClasses}>Base</label>
        <select
          value={baseCurrency}
          onChange={(e) => setBaseCurrency(e.target.value)}
          className={inputClasses}
        >
          {currencies.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <span className="text-[var(--dpf-muted)] pb-2">→</span>

      <div>
        <label className={labelClasses}>Target</label>
        <select
          value={targetCurrency}
          onChange={(e) => setTargetCurrency(e.target.value)}
          className={inputClasses}
        >
          {currencies.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelClasses}>Rate</label>
        <input
          type="number"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          className={`${inputClasses} w-32`}
          placeholder="e.g. 1.2700"
          min="0.0001"
          step="0.0001"
          required
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="px-3 py-2 rounded-md text-xs font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        {loading ? "Saving..." : "Save Rate"}
      </button>

      {saved && (
        <span className="text-[10px] pb-2" style={{ color: "var(--dpf-success)" }}>Saved</span>
      )}
    </form>
  );
}
