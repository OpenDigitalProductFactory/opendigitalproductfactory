"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateBaseCurrency } from "@/lib/actions/currency";

const inputClasses =
  "bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] text-[var(--dpf-text)] rounded px-3 py-2 text-sm focus:border-[var(--dpf-accent)] focus:outline-none";

interface Props {
  currentCurrency: string;
  currencies: string[];
}

export function BaseCurrencySelector({ currentCurrency, currencies }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState(currentCurrency);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleChange(currency: string) {
    if (currency === currentCurrency) return;
    setSelected(currency);
    setLoading(true);
    setSaved(false);

    try {
      await updateBaseCurrency(currency);
      setSaved(true);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={selected}
        onChange={(e) => handleChange(e.target.value)}
        className={inputClasses}
        disabled={loading}
      >
        {currencies.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
      {loading && (
        <span className="text-[10px] text-[var(--dpf-muted)]">Saving...</span>
      )}
      {saved && !loading && (
        <span className="text-[10px]" style={{ color: "#4ade80" }}>Saved</span>
      )}
    </div>
  );
}
